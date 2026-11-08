"""Collect only the company facts displayed on a B2B customer card."""
import re
from datetime import datetime, timezone

import httpx

from .company_site import website_data

ENTITIES = "https://data.brreg.no/enhetsregisteret/api/enheter"
ACCOUNTS = "https://data.brreg.no/regnskapsregisteret/regnskap"
TEXT_FIELDS = ("name", "industry", "city", "source", "fetched_at", "organization_number", "lookup_status",
               "chief_executive", "board_chair", "roles_status", "roles_checked_at", "period_end", "currency",
               "accounts_status", "accounts_checked_at", "website_url", "website_status", "website_summary",
               "website_checked_at")
AMOUNTS = ("revenue", "operating_profit", "equity")


def public_facts(info):
    result = {key: info[key] for key in TEXT_FIELDS if isinstance(info.get(key), str) and info[key].strip()}
    for key in AMOUNTS:
        if type(info.get(key)) in (int, float):
            result[key] = info[key]
    if type(info.get("employees")) is int and info["employees"] >= 0:
        result["employees"] = info["employees"]
    return result


def get_json(client, url, **kwargs):
    response = client.get(url, **kwargs)
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return response.json()


def match_company(name, client):
    if not name or not name.strip():
        return None
    result = get_json(client, ENTITIES, params={"navn": name.strip(), "size": 20}) or {}
    if result.get("page", {}).get("totalPages", 0) > 1:
        return None
    def normalize(value):
        return " ".join(value.split()).casefold()
    matches = [row["organisasjonsnummer"] for row in result.get("_embedded", {}).get("enheter", [])
               if normalize(row.get("navn", "")) == normalize(name)]
    return matches[0] if len(matches) == 1 else None


def financials(records, org_number):
    candidates = [row for row in records or [] if row.get("regnskapstype") == "SELSKAP"
                  and row.get("virksomhet", {}).get("organisasjonsnummer") == org_number
                  and row.get("regnskapsperiode", {}).get("tilDato")]
    if not candidates:
        return {"accounts_status": "missing"}
    row = max(candidates, key=lambda r: (r["regnskapsperiode"]["tilDato"], r.get("id") or 0))
    operating = (row.get("resultatregnskapResultat") or {}).get("driftsresultat") or {}
    return {"period_end": row["regnskapsperiode"]["tilDato"], "currency": row.get("valuta"),
            "revenue": (operating.get("driftsinntekter") or {}).get("salgsinntekter"),
            "operating_profit": operating.get("driftsresultat"),
            "equity": ((row.get("egenkapitalGjeld") or {}).get("egenkapital") or {}).get("sumEgenkapital"),
            "accounts_status": "ok"}


def management(record):
    leaders = {"chief_executive": [], "board_chair": []}
    for group in (record or {}).get("rollegrupper", []):
        for role in group.get("roller", []):
            key = {("DAGL", "DAGL"): "chief_executive", ("STYR", "LEDE"): "board_chair"}.get(
                (group.get("type", {}).get("kode"), role.get("type", {}).get("kode")))
            person = role.get("person") or {}
            if not key or role.get("fratraadt") or person.get("erDoed"):
                continue
            name = person.get("navn") or {}
            full = " ".join(name[k] for k in ("fornavn", "mellomnavn", "etternavn") if name.get(k))
            if full and full not in leaders[key]:
                leaders[key].append(full)
    return {**{k: ", ".join(v) for k, v in leaders.items() if v},
            "roles_status": "ok" if any(leaders.values()) else "missing"}


def company_data(org_number, client, previous=None, *, read_site=website_data):
    if not isinstance(org_number, str) or not re.fullmatch(r"[0-9]{9}", org_number):
        raise ValueError("Invalid organization number")
    checked = datetime.now(timezone.utc).isoformat()
    company = get_json(client, f"{ENTITIES}/{org_number}")
    if not company:
        return {"organization_number": org_number, "lookup_status": "not_found", "fetched_at": checked}
    if company.get("organisasjonsnummer") != org_number:
        raise ValueError("Mismatched organization number")
    result = {"organization_number": org_number, "lookup_status": "ok", "name": company.get("navn"),
              "employees": company.get("antallAnsatte"), "industry": (company.get("naeringskode1") or {}).get("beskrivelse"),
              "city": (company.get("forretningsadresse") or {}).get("poststed"),
              "source": "Brønnøysundregistrene / Enhetsregisteret", "fetched_at": checked}
    cached = previous if previous and previous.get("organization_number") == org_number else {}
    sources = (
        ("roles", ("chief_executive", "board_chair"), lambda: management(get_json(client, f"{ENTITIES}/{org_number}/roller"))),
        ("accounts", (*AMOUNTS, "period_end", "currency"), lambda: financials(get_json(client, f"{ACCOUNTS}/{org_number}"), org_number)),
        ("website", ("website_url", "website_summary"), lambda: read_site(company.get("hjemmeside"))),
    )
    for name, fields, read in sources:
        timestamp = name + "_checked_at"
        try:
            result.update(read())
            result[timestamp] = checked
        except (httpx.HTTPError, OSError, ValueError):
            result.update({k: cached[k] for k in (*fields, timestamp) if k in cached})
            result[name + "_status"] = "temporary_error"
    return public_facts(result)

