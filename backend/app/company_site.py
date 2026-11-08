"""Read bounded, public HTML from the company's registered website."""
import ipaddress
import socket
import time
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit
from urllib.robotparser import RobotFileParser

import httpx

BOT = "NexflowBot"
LIMIT = 800_000


class SiteUnavailable(ValueError):
    pass


def site_url(value):
    if not isinstance(value, str) or not value.strip():
        raise SiteUnavailable("missing")
    value = value.strip()
    parts = urlsplit(value if "://" in value else "https://" + value)
    if (parts.scheme not in {"http", "https"} or not parts.hostname or parts.username is not None
            or parts.password is not None or parts.port not in {None, 443} or "\\" in value):
        raise SiteUnavailable("unsupported")
    host = parts.hostname.encode("idna").decode("ascii")
    if "." not in host or ":" in host:
        raise SiteUnavailable("unsupported")
    return "https://" + host + (parts.path or "/") + ("?" + parts.query if parts.query else "")


def fetch(url, deadline):
    host = urlsplit(url).hostname
    addresses = [ipaddress.ip_address(row[4][0]) for row in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)]
    if not addresses or any(not a.is_global or a.is_multicast or getattr(a, "ipv4_mapped", None) for a in addresses):
        raise SiteUnavailable("unsupported")
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise httpx.TimeoutException("Website time limit")
    # Connect to the verified address. TLS still authenticates the registered hostname.
    target = httpx.URL(url).copy_with(host=str(addresses[0]))
    with httpx.Client(trust_env=False, timeout=min(5, remaining)) as client:
        with client.stream("GET", target, headers={"Host": host, "User-Agent": BOT,
                         "Accept-Encoding": "identity"}, extensions={"sni_hostname": host}) as response:
            if response.is_redirect:
                return response.status_code, response.headers.get("location", ""), ""
            if response.status_code != 200:
                return response.status_code, "", ""
            media = response.headers.get("content-type", "").split(";")[0].strip().lower()
            if media not in {"text/html", "application/xhtml+xml", "text/plain"}:
                raise SiteUnavailable("unsupported")
            if response.headers.get("content-encoding", "identity").lower() != "identity":
                raise SiteUnavailable("unsupported")
            content = bytearray()
            for block in response.iter_raw(8192):
                content.extend(block)
                if time.monotonic() >= deadline:
                    raise httpx.TimeoutException("Website time limit")
                if len(content) >= LIMIT:
                    break
            return 200, media, content[:LIMIT].decode(response.encoding or "utf-8", errors="replace")


class PageText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.description = ""
        self.paragraphs = []
        self.hidden = []
        self.current = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in {"script", "style", "nav", "footer", "header", "noscript", "template"}:
            self.hidden.append(tag)
        if self.hidden:
            return
        if tag == "meta" and (attrs.get("name") or attrs.get("property") or "").lower() in {"description", "og:description"}:
            self.description = self.description or attrs.get("content") or ""
        if tag == "p":
            self.current = []

    def handle_endtag(self, tag):
        if self.hidden:
            if tag == self.hidden[-1]:
                self.hidden.pop()
            return
        if tag == "p" and self.current is not None:
            self.paragraphs.append("".join(self.current))
            self.current = None

    def handle_data(self, data):
        if not self.hidden and self.current is not None:
            self.current.append(data)


def summarize(html):
    page = PageText()
    page.feed(html)
    chosen = []
    for raw in [page.description, *page.paragraphs]:
        line = " ".join(raw.split())
        if len(line) < 40 or any(term in line.lower() for term in ("cookies", "informasjonskaps", "personvern", "javascript")):
            continue
        if any(line.casefold() in old.casefold() or old.casefold() in line.casefold() for old in chosen):
            continue
        chosen.append(line)
        if len(chosen) == 2 or len(line) >= 170:
            break
    result = " ".join(chosen)
    return result if len(result) <= 500 else result[:497].rsplit(" ", 1)[0] + "…"


def website_data(homepage):
    if not homepage:
        return {"website_status": "missing"}
    try:
        url = site_url(homepage)
        deadline = time.monotonic() + 15
        for _ in range(4):
            robots_url = urljoin(url, "/robots.txt")
            status, _, rules = fetch(robots_url, deadline)
            if status == 429 or status >= 500:
                raise httpx.RequestError("Website temporarily unavailable")
            if status == 200:
                robots = RobotFileParser()
                robots.parse(rules.splitlines())
                if not robots.can_fetch(BOT, url):
                    raise SiteUnavailable("restricted")
            elif status not in {404, 410}:
                raise SiteUnavailable("restricted")
            status, kind, body = fetch(url, deadline)
            if status in {301, 302, 303, 307, 308} and kind:
                url = site_url(urljoin(url, kind))
                continue
            if status == 429 or status >= 500:
                raise httpx.RequestError("Website temporarily unavailable")
            if status != 200 or kind not in {"text/html", "application/xhtml+xml"}:
                raise SiteUnavailable("unavailable")
            summary = summarize(body)
            return {"website_url": url, "website_summary": summary, "website_status": "ok" if summary else "no_text"}
    except SiteUnavailable as exc:
        return {"website_status": str(exc)}
    except (UnicodeError, ValueError, LookupError):
        return {"website_status": "unsupported"}
    return {"website_status": "unavailable"}
