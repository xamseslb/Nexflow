"""Bounded, project-scoped company discovery. No paid search or person lookup."""
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import UUID

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import Field, field_validator
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .api import Db, MANAGERS, audit, project_access
from .company_registry import ENTITIES, get_json
from .models import CallList, DiscoveryRecord, DiscoverySettings, Job, Lead, Project
from .schemas import Input

router = APIRouter(prefix="/api/v1/projects/{project_id}/discovery")
CATALOG = json.loads((Path(__file__).parent / "data/industries.json").read_text(encoding="utf-8-sig"))
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


def normal_phone(value):
    if not isinstance(value, str):
        return ""
    digits = re.sub(r"[\s().-]", "", value)
    if digits.startswith("0047"):
        digits = "+47" + digits[4:]
    if re.fullmatch(r"[2-9][0-9]{7}", digits):
        digits = "+47" + digits
    return digits if re.fullmatch(r"\+47[2-9][0-9]{7}", digits) else ""


def imported_today(db, project_id):
    return db.scalar(select(func.count(Lead.id)).where(Lead.project_id == project_id,
        Lead.source == "brreg_discovery", Lead.created_at >= text(
            "(date_trunc('day', clock_timestamp() AT TIME ZONE 'Europe/Oslo') AT TIME ZONE 'Europe/Oslo')"))) or 0


def configuration(db, project_id):
    cfg = db.scalar(select(DiscoverySettings).where(DiscoverySettings.project_id == project_id))
    return {"enabled": cfg.enabled if cfg else False, "industries": cfg.industries if cfg else [],
            "call_list_id": cfg.call_list_id if cfg else None, "municipality": "0301",
            "area": "Oslo", "daily_limit": cfg.daily_limit if cfg else 20,
            "imported_today": imported_today(db, project_id), "last_run_at": cfg.last_run_at if cfg else None,
            "next_run_at": cfg.next_run_at if cfg and cfg.enabled else None,
            "last_summary": cfg.last_summary if cfg else {}, "last_error": cfg.last_error if cfg else None}


@router.get("")
def get_discovery(project_id: UUID, db: Session = Db):
    project_access(db, project_id, MANAGERS)
    return {"settings": configuration(db, project_id), "catalog": CATALOG["items"],
            "catalog_source": CATALOG["source"], "catalog_as_of": CATALOG["as_of"]}


@router.patch("")
def save_discovery(project_id: UUID, body: DiscoveryChange, db: Session = Db):
    project = project_access(db, project_id, MANAGERS)
    if body.enabled and (not project.active or project.kind not in ("b2b", "both")):
        raise HTTPException(422, "Bedriftssøk krever et aktivt B2B-prosjekt")
    queue = db.scalar(select(CallList).where(CallList.id == body.call_list_id,
        CallList.project_id == project_id, CallList.category == "cold"))
    if not queue:
        raise HTTPException(422, "Velg en Cold-kø i dette prosjektet")
    # The advisory lock serializes first-time setup, before there is a row to lock.
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"), {"key": f"discovery:{project_id}"})
    cfg = db.scalar(select(DiscoverySettings).where(DiscoverySettings.project_id == project_id).with_for_update())
    if cfg is None:
        cfg = DiscoverySettings(project_id=project_id, partner_id=project.partner_id)
        db.add(cfg)
    if cfg.industries != body.industries:
        cfg.page = cfg.offset = 0
    cfg.enabled, cfg.industries, cfg.call_list_id = body.enabled, body.industries, queue.id
    cfg.next_run_at, cfg.last_error = datetime.now(timezone.utc), None
    db.flush()
    audit(db, project, "discovery.settings_changed", cfg.id,
          {"enabled": cfg.enabled, "industries": cfg.industries, "daily_limit": cfg.daily_limit})
    return configuration(db, project_id)


@router.get("/records")
def records(project_id: UUID, status: str = Query("all", pattern="^(all|imported|review|duplicate|excluded|rejected)$"),
            page: int = Query(0, ge=0, le=10000), db: Session = Db):
    project_access(db, project_id, MANAGERS)
    query = select(DiscoveryRecord).where(DiscoveryRecord.project_id == project_id)
    if status != "all":
        query = query.where(DiscoveryRecord.status == status)
    rows = list(db.scalars(query.order_by(DiscoveryRecord.created_at.desc(), DiscoveryRecord.id).offset(page*30).limit(31)))
    return {"items": [{key: getattr(row, key) for key in ("id", "company", "org_number", "status", "reason",
            "lead_id", "source_url", "created_at")} for row in rows[:30]], "has_more": len(rows) > 30}


@router.post("/records/{record_id}/review")
def review(project_id: UUID, record_id: UUID, body: ReviewChange, db: Session = Db):
    project = project_access(db, project_id, MANAGERS)
    cfg = db.scalar(select(DiscoverySettings).where(DiscoverySettings.project_id == project_id).with_for_update())
    record = db.scalar(select(DiscoveryRecord).where(DiscoveryRecord.id == record_id,
        DiscoveryRecord.project_id == project_id).with_for_update())
    if not record or record.status != "review":
        raise HTTPException(409, "Treffet er allerede behandlet eller finnes ikke")
    lead = db.scalar(select(Lead).where(Lead.id == record.lead_id, Lead.project_id == project_id).with_for_update())
    if not lead or not lead.review_required:
        raise HTTPException(409, "Kontaktkortet er allerede endret")
    if body.decision == "reject":
        lead.status, record.status, record.reason = "declined", "rejected", "Avvist ved gjennomgang"
    else:
        phone = normal_phone(body.phone)
        queue = db.get(CallList, cfg.call_list_id) if cfg and cfg.call_list_id else None
        if not phone or not body.confirmed_business_number or not queue or queue.category != "cold":
            raise HTTPException(422, "Oppgi et norsk bedriftsnummer og velg en Cold-kø i innstillingene")
        if not project.active or lead.blocked or lead.status != "new":
            raise HTTPException(409, "Prosjektet eller kontakten tillater ikke godkjenning")
        lead.phone, lead.review_required, lead.call_list_id = phone, False, queue.id
        record.status, record.reason = "imported", "Bedriftsnummer kontrollert av leder"
    audit(db, project, "discovery.reviewed", lead.id, {"decision": body.decision})
    return {"status": record.status, "lead_id": lead.id}


def exclusion(row, industries):
    if not isinstance(row, dict) or not re.fullmatch(r"[0-9]{9}", str(row.get("organisasjonsnummer", ""))):
        return "Ugyldig registertreff"
    if (row.get("forretningsadresse") or {}).get("kommunenummer") != "0301":
        return "Utenfor Oslo"
    if any(row.get(key) for key in ("konkurs", "underAvvikling", "underTvangsavviklingEllerTvangsopplosning", "slettedato")):
        return "Virksomheten er ikke aktiv"
    if row.get("reservasjonsregisteret") is True or row.get("reservertMotReklame") is True:
        return "Registrert reklamereservasjon"
    if industries and not any(str((row.get(f"naeringskode{i}") or {}).get("kode", ""))[:2] in industries for i in (1, 2, 3)):
        return "Utenfor valgte bransjer"
    if not str(row.get("navn") or "").strip():
        return "Mangler bedriftsnavn"
    return None


def run_discovery_once(engine, client):
    """One page per transaction/run. A locked settings row serializes quota usage."""
    with Session(engine) as db, db.begin():
        unsafe = db.scalar(text("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user"))
        if unsafe:
            raise RuntimeError("Discovery requires a restricted worker login")
        db.execute(text("SET LOCAL ROLE hub_worker"))
        cfg = db.scalar(select(DiscoverySettings).join(Project, Project.id == DiscoverySettings.project_id)
            .where(DiscoverySettings.enabled.is_(True), DiscoverySettings.next_run_at <= func.now(),
                   Project.active.is_(True), Project.kind.in_(("b2b", "both")))
            .order_by(DiscoverySettings.next_run_at, DiscoverySettings.id)
            .with_for_update(of=DiscoverySettings, skip_locked=True).limit(1))
        if not cfg:
            return False
        now = datetime.now(timezone.utc)
        cfg.last_run_at, cfg.last_error = now, None
        cfg.next_run_at = now + timedelta(hours=1)
        quota = cfg.daily_limit - imported_today(db, cfg.project_id)
        if quota <= 0:
            cfg.last_summary = {"quota_reached": True}
            return True
        queue = db.get(CallList, cfg.call_list_id)
        if not queue or queue.category != "cold":
            cfg.last_error = "Cold-køen mangler eller er endret. Velg kø på nytt."
            return True
        params = {"forretningsadresse.kommunenummer": "0301", "konkurs": "false", "size": 50,
                  "page": cfg.page, "sort": "organisasjonsnummer,ASC"}
        if cfg.industries:
            params["naeringskode"] = ",".join(cfg.industries)
        try:
            response = get_json(client, ENTITIES, params=params)
            rows = (response.get("_embedded") or {}).get("enheter", [])
            pages = response["page"]["totalPages"]
            if not isinstance(rows, list) or not isinstance(pages, int) or len(rows) > 50:
                raise ValueError("Unexpected register response")
        except (httpx.HTTPError, OSError, ValueError, KeyError, TypeError, AttributeError):
            cfg.last_error = "Brønnøysundregistrene svarte ikke som forventet. Vi prøver igjen neste time."
            return True  # Preserve the cursor on source failure.
        summary = {"scanned": 0, "imported": 0, "review": 0, "duplicate": 0, "excluded": 0}
        for index in range(cfg.offset, len(rows)):
            if quota <= 0:
                break
            row = rows[index]
            cfg.offset = index + 1 if index < 49 else 0
            summary["scanned"] += 1
            org = str(row.get("organisasjonsnummer", "")) if isinstance(row, dict) else ""
            if not re.fullmatch(r"[0-9]{9}", org):
                summary["excluded"] += 1
                continue
            if db.scalar(select(DiscoveryRecord.id).where(DiscoveryRecord.project_id == cfg.project_id, DiscoveryRecord.org_number == org)):
                summary["duplicate"] += 1
                continue
            reason = exclusion(row, cfg.industries)
            existing = db.scalar(select(Lead.id).where(Lead.project_id == cfg.project_id, Lead.org_number == org).limit(1))
            # Never recreate a blocked or declined contact, nor an existing customer.
            status, lead_id = ("duplicate", None) if existing else ("excluded", None)
            if existing:
                reason = "Finnes allerede i prosjektet"
            if not reason:
                phone = normal_phone(row.get("telefon")) or normal_phone(row.get("mobil"))
                needs_review = not bool(phone)
                values = dict(project_id=cfg.project_id, partner_id=cfg.partner_id, company=row["navn"][:200],
                    phone=phone, org_number=org, kind="b2b", status="new", source="brreg_discovery", city="Oslo",
                    industry=str((row.get("naeringskode1") or {}).get("beskrivelse") or "")[:120],
                    call_list_id=None if needs_review else cfg.call_list_id, review_required=needs_review,
                    enrichment={"organization_number": org, "source": "Brønnøysundregistrene / Enhetsregisteret",
                                "fetched_at": now.isoformat(), "lookup_status": "pending_enrichment"})
                # A concurrent manual import may win. The unique index prevents duplicates.
                lead_id = db.scalar(insert(Lead).values(**values).on_conflict_do_nothing(
                    index_elements=[Lead.project_id, Lead.org_number],
                    index_where=text("kind='b2b' AND org_number IS NOT NULL AND org_number <> ''")).returning(Lead.id))
                if lead_id:
                    quota -= 1
                    status = "review" if needs_review else "imported"
                    reason = "Mangler gyldig norsk bedriftsnummer" if needs_review else "Lagt i Cold-kø"
                    db.execute(insert(Job).values(project_id=cfg.project_id, partner_id=cfg.partner_id,
                        kind="brreg_enrichment", payload={"lead_id": str(lead_id)}))
                else:
                    status, reason = "duplicate", "Finnes allerede i prosjektet"
            db.add(DiscoveryRecord(project_id=cfg.project_id, partner_id=cfg.partner_id, org_number=org,
                company=str(row.get("navn") or org)[:200], status=status, reason=reason, lead_id=lead_id,
                source_url=f"{ENTITIES}/{org}"))
            db.flush()
            summary[status] += 1
        # Advance only when the entire page was inspected; retain offset at quota limit.
        if not rows or cfg.offset >= len(rows) or summary["scanned"] and cfg.offset == 0:
            cfg.page += 1
            cfg.offset = 0
        if cfg.page >= pages:
            cfg.page = cfg.offset = 0
            cfg.next_run_at = now + timedelta(days=1)
        cfg.last_summary = summary
        return True
