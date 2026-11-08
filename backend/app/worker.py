"""Refresh B2B customer cards using the restricted worker login."""
import argparse
import json
import time
from datetime import datetime, timedelta, timezone
from uuid import UUID

import httpx
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from .company_registry import company_data, match_company
from .config import settings
from .models import Job, Lead


def schedule(job, partial=False):
    now = datetime.now(timezone.utc)
    job.status = "pending"
    if partial:
        job.attempts += 1
        job.last_error = "A company data source is temporarily unavailable"
        if job.attempts < 5:
            job.available_at = now + timedelta(minutes=5 * 2 ** (job.attempts - 1))
            return
    else:
        job.last_error = None
    job.attempts = 0
    job.available_at = now + timedelta(days=1)


def run_once(engine, client: httpx.Client) -> bool:
    with Session(engine) as db, db.begin():
        unsafe = db.scalar(text("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user"))
        if unsafe:
            raise RuntimeError("Worker requires a restricted login role")
        db.execute(text("SET LOCAL ROLE hub_worker"))
        job = db.scalar(select(Job).where(Job.kind == "brreg_enrichment", Job.status == "pending",
                        Job.available_at <= datetime.now(timezone.utc))
                        .order_by(Job.available_at, Job.id).with_for_update(skip_locked=True).limit(1))
        if not job:
            return False
        try:
            lead_id = UUID(job.payload["lead_id"])
        except (KeyError, TypeError, ValueError, AttributeError):
            job.status, job.last_error = "failed", "Invalid lead identifier"
            return True
        lead = db.scalar(select(Lead).where(Lead.id == lead_id, Lead.project_id == job.project_id,
                                            Lead.partner_id == job.partner_id, Lead.kind == "b2b"))
        if not lead:
            job.status, job.last_error = "done", None
            return True
        try:
            number = lead.org_number or match_company(lead.company, client)
            if number:
                data = company_data(number, client, lead.enrichment)
            else:
                data = {"lookup_status": "no_unique_match", "fetched_at": datetime.now(timezone.utc).isoformat()}
            lead.enrichment = data
            if data.get("industry"):
                lead.industry = data["industry"][:120]
            if data.get("city"):
                lead.city = data["city"][:100]
            schedule(job, any(data.get(key) == "temporary_error" for key in ("roles_status", "accounts_status", "website_status")))
        except (httpx.HTTPError, OSError, ValueError, KeyError):
            lead.enrichment = {**(lead.enrichment or {}), "lookup_status": "temporary_error"}
            schedule(job, partial=True)
        return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--lookup", metavar="ORGNR", help="Read a company's current public facts without writing to the CRM")
    args = parser.parse_args()
    with httpx.Client(timeout=10, follow_redirects=False, headers={"User-Agent": "NexflowBot"}) as client:
        if args.lookup:
            print(json.dumps(company_data(args.lookup, client), ensure_ascii=False, indent=2))
            return
        if not settings().worker_database_url:
            raise SystemExit("WORKER_DATABASE_URL is required")
        engine = create_engine(settings().worker_database_url, pool_pre_ping=True, pool_size=2)
        while True:
            worked = run_once(engine, client)
            if args.once:
                return
            time.sleep(1 if worked else 3)


if __name__ == "__main__":
    main()
