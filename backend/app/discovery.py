"""Manage a project’s discovery settings and review candidate company phone numbers."""

import json
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from pydantic import Field, field_validator
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .company_phone import normal_phone
from .company_registry import public_facts
from .discovery_import import imported_today
from .models import CallList, DiscoveryRecord, DiscoverySettings, Lead
from .project_access import MANAGERS, Db, audit, project_access
from .schemas import Input

router = APIRouter(prefix="/api/v1/projects/{project_id}/discovery")
CATALOG = json.loads(
    (Path(__file__).parent / "data/industries.json").read_text(encoding="utf-8-sig")
)
CODES = {item["code"] for item in CATALOG["items"]}


class DiscoveryChange(Input):
    enabled: bool
    industries: list[str] = Field(max_length=87)
    call_list_id: UUID

    @field_validator("industries")
    @classmethod
    def known_codes(cls, value):
        if any(code not in CODES for code in value):
            raise ValueError("Velg gyldige næringskoder fra listen")
        return sorted(set(value))


class ReviewChange(Input):
    decision: str = Field(pattern="^(approve|reject)$")
    phone: str = Field(default="", max_length=30)
    confirmed_business_number: bool = False


def configuration(db, project_id):
    cfg = db.scalar(select(DiscoverySettings).where(DiscoverySettings.project_id == project_id))
    return {
        "enabled": cfg.enabled if cfg else False,
        "industries": cfg.industries if cfg else [],
        "call_list_id": cfg.call_list_id if cfg else None,
        "municipality": "0301",
        "area": "Oslo",
        "daily_limit": cfg.daily_limit if cfg else 20,
        "imported_today": imported_today(db, project_id),
        "last_run_at": cfg.last_run_at if cfg else None,
        "next_run_at": cfg.next_run_at if cfg and cfg.enabled else None,
        "last_summary": cfg.last_summary if cfg else {},
        "last_error": cfg.last_error if cfg else None,
    }


@router.get("")
def get_discovery(project_id: UUID, db: Session = Db):
    project_access(db, project_id, MANAGERS)
    return {
        "settings": configuration(db, project_id),
        "catalog": CATALOG["items"],
        "catalog_source": CATALOG["source"],
        "catalog_as_of": CATALOG["as_of"],
    }


@router.patch("")
def save_discovery(project_id: UUID, body: DiscoveryChange, db: Session = Db):
    project = project_access(db, project_id, MANAGERS)
    if body.enabled and (not project.active or project.kind not in ("b2b", "both")):
        raise HTTPException(422, "Bedriftssøk krever et aktivt B2B-prosjekt")
    queue = db.scalar(
        select(CallList).where(
            CallList.id == body.call_list_id,
            CallList.project_id == project_id,
            CallList.category == "cold",
        )
    )
    if not queue:
        raise HTTPException(422, "Velg en Cold-kø i dette prosjektet")
    # The advisory lock serializes first-time setup, before there is a row to lock.
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"),
        {"key": f"discovery:{project_id}"},
    )
    cfg = db.scalar(
        select(DiscoverySettings)
        .where(DiscoverySettings.project_id == project_id)
        .with_for_update()
    )
    if cfg is None:
        cfg = DiscoverySettings(project_id=project_id, partner_id=project.partner_id)
        db.add(cfg)
    if cfg.industries != body.industries:
        cfg.page = cfg.offset = 0
    cfg.enabled, cfg.industries, cfg.call_list_id = body.enabled, body.industries, queue.id
    cfg.next_run_at, cfg.last_error = datetime.now(timezone.utc), None
    db.flush()
    audit(
        db,
        project,
        "discovery.settings_changed",
        cfg.id,
        {"enabled": cfg.enabled, "industries": cfg.industries, "daily_limit": cfg.daily_limit},
    )
    return configuration(db, project_id)


@router.get("/records")
def records(
    project_id: UUID,
    status: str = Query("all", pattern="^(all|imported|review|duplicate|excluded|rejected)$"),
    page: int = Query(0, ge=0, le=10000),
    db: Session = Db,
):
    project_access(db, project_id, MANAGERS)
    query = select(DiscoveryRecord).where(DiscoveryRecord.project_id == project_id)
    if status != "all":
        query = query.where(DiscoveryRecord.status == status)
    rows = list(
        db.scalars(
            query.order_by(DiscoveryRecord.created_at.desc(), DiscoveryRecord.id)
            .offset(page * 30)
            .limit(31)
        )
    )
    leads = {
        lead.id: lead
        for lead in db.scalars(
            select(Lead).where(
                Lead.project_id == project_id,
                Lead.id.in_([row.lead_id for row in rows[:30] if row.lead_id]),
            )
        )
    }
    items = []
    for row in rows[:30]:
        item = {
            key: getattr(row, key)
            for key in (
                "id",
                "company",
                "org_number",
                "status",
                "reason",
                "lead_id",
                "source_url",
                "created_at",
            )
        }
        facts = public_facts(leads[row.lead_id].enrichment or {}) if row.lead_id in leads else {}
        item.update(
            {
                key: facts.get(key)
                for key in ("website_phones", "website_phone_status", "website_checked_at")
            }
        )
        items.append(item)
    return {"items": items, "has_more": len(rows) > 30}


@router.post("/records/{record_id}/review")
def review(project_id: UUID, record_id: UUID, body: ReviewChange, db: Session = Db):
    project = project_access(db, project_id, MANAGERS)
    cfg = db.scalar(
        select(DiscoverySettings)
        .where(DiscoverySettings.project_id == project_id)
        .with_for_update()
    )
    record = db.scalar(
        select(DiscoveryRecord)
        .where(DiscoveryRecord.id == record_id, DiscoveryRecord.project_id == project_id)
        .with_for_update()
    )
    if not record or record.status != "review":
        raise HTTPException(409, "Treffet er allerede behandlet eller finnes ikke")
    lead = db.scalar(
        select(Lead)
        .where(Lead.id == record.lead_id, Lead.project_id == project_id)
        .with_for_update()
    )
    if not lead or not lead.review_required:
        raise HTTPException(409, "Kontaktkortet er allerede endret")
    if body.decision == "reject":
        lead.status, record.status, record.reason = "declined", "rejected", "Avvist ved gjennomgang"
    else:
        phone = normal_phone(body.phone)
        queue = db.get(CallList, cfg.call_list_id) if cfg and cfg.call_list_id else None
        if not phone or not body.confirmed_business_number or not queue or queue.category != "cold":
            raise HTTPException(
                422, "Oppgi et norsk bedriftsnummer og velg en Cold-kø i innstillingene"
            )
        if not project.active or lead.blocked or lead.status != "new":
            raise HTTPException(409, "Prosjektet eller kontakten tillater ikke godkjenning")
        lead.phone, lead.review_required, lead.call_list_id = phone, False, queue.id
        record.status, record.reason = "imported", "Bedriftsnummer kontrollert av leder"
    audit(db, project, "discovery.reviewed", lead.id, {"decision": body.decision})
    return {"status": record.status, "lead_id": lead.id}
