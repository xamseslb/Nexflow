"""Conservative extraction of explicitly labelled public business numbers."""
import re
from html.parser import HTMLParser
from urllib.parse import unquote, urljoin, urlsplit


def normal_phone(value):
    if not isinstance(value, str):
        return ""
    digits = re.sub(r"[\s().-]", "", value)
    if digits.startswith("0047"):
        digits = "+47" + digits[4:]
    if re.fullmatch(r"[2-9][0-9]{7}", digits):
        digits = "+47" + digits
    return digits if re.fullmatch(r"\+47[2-9][0-9]{7}", digits) else ""


class ContactPage(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hidden = []
        self.lines = []
        self.links = []
        self.phones = []
        self.anchor = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in {"script", "style", "noscript", "template"}:
            self.hidden.append(tag)
        if self.hidden:
            return
        if tag in {"p", "div", "li", "br", "tr"}:
            self.lines.append("\n")
        if tag == "a":
            href = attrs.get("href", "")
            self.anchor = [href, ""]

    def handle_endtag(self, tag):
        if self.hidden:
            if self.hidden[-1] == tag:
                self.hidden.pop()
            return
        if tag == "a" and self.anchor:
            href, label = self.anchor
            context = ''.join(self.lines).split('\n')[-1]
            if href.lower().startswith('tel:') and not re.search(r'\b(?:fax|faks)\b', context + ' ' + label, re.I):
                phone = normal_phone(unquote(href[4:]))
                if phone:
                    self.phones.append(phone)
            self.links.append(tuple(self.anchor))
            self.anchor = None
        if tag in {"p", "div", "li", "tr"}:
            self.lines.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.lines.append(data)
            if self.anchor:
                self.anchor[1] += data


def contacts(html, url):
    page = ContactPage()
    page.feed(html)
    # Never interpret an unlabelled invoice, org number or price as a phone.
    labelled = re.compile(r"\b(?:telefon|telephone|phone|tlf|tel|mobil|sentralbord)\.?\s*:?\s*([+\d][\d ()\u00a0.\t-]{6,24})", re.I)
    for line in "".join(page.lines).splitlines():
        if re.search(r"\b(?:fax|faks)\b", line, re.I):
            continue
        for match in labelled.finditer(line):
            phone = normal_phone(match.group(1).strip())
            if phone:
                page.phones.append(phone)
    links = []
    for href, label in page.links:
        if not re.search(r"kontakt|contact|om[- /]?oss|about[- /]?us", href + " " + label, re.I):
            continue
        target = urljoin(url, href).split("#")[0]
        if urlsplit(target).netloc == urlsplit(url).netloc and urlsplit(target).scheme == "https" and target != url and target not in links:
            links.append(target)
    return [{"phone": p, "source_url": url} for p in dict.fromkeys(page.phones)][:5], links[:2]
