"""Restricted PostgreSQL job worker. Run: python -m app.worker [--once]."""
import argparse
import time
from datetime import datetime, timedelta, timezone
from uuid import UUID
import httpx
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session
from .config import settings
from .models import Job, Lead


def company_data(org_number: str, client: httpx.Client) -> dict:
    if len(org_number) != 9 or not org_number.isdigit():
        raise ValueError("Invalid organization number")
    response = client.get(f"https://data.brreg.no/enhetsregisteret/api/enheter/{org_number}")
    response.raise_for_status()
    data = response.json()
    # Whitelist company fields. Do not collect private-person details.
    return {"name": data.get("navn"), "employees": data.get("antallAnsatte"),
            "industry": data.get("naeringskode1", {}).get("beskrivelse", ""),
            "city": data.get("forretningsadresse", {}).get("poststed", ""),
            "source": "Brønnøysundregistrene / Enhetsregisteret", "fetched_at": datetime.now(timezone.utc).isoformat()}


def run_once(engine, client: httpx.Client) -> bool:
    with Session(engine) as db, db.begin():
        unsafe = db.scalar(text("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user"))
        if unsafe:
            raise RuntimeError("Worker requires a restricted login role")
        db.execute(text("SET LOCAL ROLE hub_worker"))
        job = db.scalar(select(Job).where(Job.status == "pending", Job.available_at <= datetime.now(timezone.utc))
                        .order_by(Job.available_at).with_for_update(skip_locked=True).limit(1))
        if not job:
            return False
        job.attempts += 1
        try:
            if job.kind != "brreg_enrichment":
                raise ValueError("Unsupported job type")
            lead = db.scalar(select(Lead).where(Lead.id == UUID(job.payload["lead_id"]), Lead.project_id == job.project_id, Lead.partner_id == job.partner_id, Lead.kind == "b2b"))
            if not lead or not lead.org_number:
                raise ValueError("No eligible business lead")
            data = company_data(lead.org_number, client)
            lead.enrichment, lead.industry, lead.city = data, data["industry"], data["city"]
            job.status, job.last_error = "done", None
        except (httpx.HTTPError, ValueError, KeyError):
            # No personal data, tokens or remote response bodies in error logs.
            job.last_error = "Enrichment failed; inspect provider availability and company identifier"
            job.status = "failed" if job.attempts >= 5 else "pending"
            job.available_at = datetime.now(timezone.utc) + timedelta(seconds=min(30 * 2 ** job.attempts, 3600))
        return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()
    if not settings().worker_database_url:
        raise SystemExit("WORKER_DATABASE_URL is required")
    engine = create_engine(settings().worker_database_url, pool_pre_ping=True, pool_size=2)
    with httpx.Client(timeout=10, follow_redirects=False) as client:
        while True:
            worked = run_once(engine, client)
            if args.once:
                return
            if not worked:
                time.sleep(2)


if __name__ == "__main__":
    main()
