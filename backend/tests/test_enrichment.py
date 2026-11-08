import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app import company_site
from app.api import create_lead
from app.company_registry import company_data, match_company
from app.models import Job, Lead
from app.schemas import LeadCreate
from app.worker import run_once
from test_postgres import as_user, tenant_data

ORG = "123456789"
ENTITY = json.loads((Path(__file__).parent / "fixtures/brreg.json").read_text(encoding="utf-8"))


def registry(request):
    assert request.url.host == "data.brreg.no"
    if request.url.path.endswith("/enheter"):
        return httpx.Response(200, json={"_embedded": {"enheter": [ENTITY]}})
    if request.url.path.endswith("/roller"):
        return httpx.Response(200, json={"rollegrupper": [{"type": {"kode": "STYR"}, "roller": [
            {"type": {"kode": "LEDE"}, "person": {"navn": {"fornavn": "Eva", "etternavn": "Eksempel"}, "private": "excluded"}},
            {"type": {"kode": "MEDL"}, "person": {"navn": {"fornavn": "Hidden"}}}]}]})
    if "regnskapsregisteret" in request.url.path:
        company = {"virksomhet": {"organisasjonsnummer": ORG}, "regnskapstype": "SELSKAP", "valuta": "NOK",
                   "regnskapsperiode": {"tilDato": "2025-12-31"},
                   "resultatregnskapResultat": {"driftsresultat": {"driftsinntekter": {"salgsinntekter": 0}, "driftsresultat": -200}},
                   "egenkapitalGjeld": {"egenkapital": {"sumEgenkapital": 3000}}}
        return httpx.Response(200, json=[company, {**company, "regnskapstype": "KONSERN", "regnskapsperiode": {"tilDato": "2026-12-31"}}])
    return httpx.Response(200, json=ENTITY)


def test_company_sources_and_partial_refresh():
    with httpx.Client(transport=httpx.MockTransport(registry)) as client:
        info = company_data(ORG, client)
    assert info["employees"] == 12 and info["city"] == "BERGEN"
    assert info["board_chair"] == "Eva Eksempel" and "chief_executive" not in info
    assert info["revenue"] == 0 and info["operating_profit"] == -200 and info["equity"] == 3000
    assert info["website_status"] == "missing"
    def unavailable(request):
        return httpx.Response(503) if "regnskapsregisteret" in request.url.path else registry(request)
    with httpx.Client(transport=httpx.MockTransport(unavailable)) as client:
        refreshed = company_data(ORG, client, info)
    assert refreshed["accounts_status"] == "temporary_error"
    assert refreshed["accounts_checked_at"] == info["accounts_checked_at"] and refreshed["revenue"] == 0


def test_ambiguous_name_and_invalid_identifier():
    with httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(
            200, json={"_embedded": {"enheter": [ENTITY, ENTITY]}}))) as client:
        assert match_company(ENTITY["navn"], client) is None
        with pytest.raises(ValueError):
            company_data("invalid", client)


def test_public_website_summary_and_robots(monkeypatch):
    message = "Vi bygger og vedlikeholder digitale løsninger for norske kommuner."
    def fetch(url, deadline):
        if url.endswith("/robots.txt"):
            return 200, "text/plain", "User-agent: *\nAllow: /"
        return 200, "text/html", f"<nav><p>{'Menu ' * 20}</p></nav><p>{message}</p>"
    monkeypatch.setattr(company_site, "fetch", fetch)
    assert company_site.website_data("www.example.no")["website_summary"] == message
    monkeypatch.setattr(company_site, "fetch", lambda url, deadline: (200, "text/plain", "User-agent: *\nDisallow: /"))
    assert company_site.website_data("www.example.no") == {"website_status": "restricted"}


@pytest.mark.postgres
def test_worker_discovers_lead_by_name_and_reschedules(tenant_data):
    engine, users, _, projects, _ = tenant_data
    with as_user(engine, users[0]) as db:
        result = create_lead(projects[0], LeadCreate(company=ENTITY["navn"], phone="+4712345678"), db)
    with httpx.Client(transport=httpx.MockTransport(registry)) as client, engine.begin() as connection:
        connection.execute(text("SET LOCAL ROLE hub_worker"))
        assert run_once(connection, client)
        assert not run_once(connection, client)
    with Session(engine) as db:
        lead = db.get(Lead, result["id"])
        assert lead.enrichment["equity"] == 3000 and lead.enrichment["organization_number"] == ORG
        job = db.scalar(select(Job).where(Job.project_id == projects[0]))
        assert job.status == "pending" and job.attempts == 0
        assert job.available_at > datetime.now(timezone.utc) + timedelta(hours=23)
