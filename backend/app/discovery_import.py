"""Scan one page of eligible companies and enqueue enrichment in a single transaction."""

import re
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from .company_phone import normal_phone
from .company_registry import ENTITIES, get_json
from .models import CallList, DiscoveryRecord, DiscoverySettings, Job, Lead, Project


def imported_today(db, project_id):
    # Both new Cold leads and records awaiting a phone check consume the same daily quota.
    return (
        db.scalar(
            select(func.count(Lead.id)).where(
                Lead.project_id == project_id,
                Lead.source == "brreg_discovery",
                Lead.created_at
                >= text(
                    "(date_trunc('day', clock_timestamp() AT TIME ZONE 'Europe/Oslo') AT TIME ZONE 'Europe/Oslo')"
                ),
            )
        )
        or 0
    )


def exclusion(row, industries):
    if not isinstance(row, dict) or not re.fullmatch(
        r"[0-9]{9}", str(row.get("organisasjonsnummer", ""))
    ):
        return "Ugyldig registertreff"
    if (row.get("forretningsadresse") or {}).get("kommunenummer") != "0301":
        return "Utenfor Oslo"
    if any(
        row.get(key)
        for key in (
            "konkurs",
            "underAvvikling",
            "underTvangsavviklingEllerTvangsopplosning",
            "slettedato",
        )
    ):
        return "Virksomheten er ikke aktiv"
    if row.get("reservasjonsregisteret") is True or row.get("reservertMotReklame") is True:
        return "Registrert reklamereservasjon"
    if industries and not any(
        str((row.get(f"naeringskode{i}") or {}).get("kode", ""))[:2] in industries
        for i in (1, 2, 3)
    ):
        return "Utenfor valgte bransjer"
    if not str(row.get("navn") or "").strip():
        return "Mangler bedriftsnavn"
    return None


def run_discovery_once(engine, client):
    """One page per transaction/run. A locked settings row serializes quota usage."""
    with Session(engine) as db, db.begin():
        unsafe = db.scalar(
            text("SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname=current_user")
        )
        if unsafe:
            raise RuntimeError("Discovery requires a restricted worker login")
        db.execute(text("SET LOCAL ROLE hub_worker"))
        cfg = db.scalar(
            select(DiscoverySettings)
            .join(Project, Project.id == DiscoverySettings.project_id)
            .where(
                DiscoverySettings.enabled.is_(True),
                DiscoverySettings.next_run_at <= func.now(),
                Project.active.is_(True),
                Project.kind.in_(("b2b", "both")),
            )
            .order_by(DiscoverySettings.next_run_at, DiscoverySettings.id)
            .with_for_update(of=DiscoverySettings, skip_locked=True)
            .limit(1)
        )
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
        params = {
            "forretningsadresse.kommunenummer": "0301",
            "konkurs": "false",
            "size": 50,
            "page": cfg.page,
            "sort": "organisasjonsnummer,ASC",
        }
        if cfg.industries:
            params["naeringskode"] = ",".join(cfg.industries)
        try:
            response = get_json(client, ENTITIES, params=params)
            rows = (response.get("_embedded") or {}).get("enheter", [])
            pages = response["page"]["totalPages"]
            if not isinstance(rows, list) or not isinstance(pages, int) or len(rows) > 50:
                raise ValueError("Unexpected register response")
        except (httpx.HTTPError, OSError, ValueError, KeyError, TypeError, AttributeError):
            cfg.last_error = (
                "Brønnøysundregistrene svarte ikke som forventet. Vi prøver igjen neste time."
            )
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
            if db.scalar(
                select(DiscoveryRecord.id).where(
                    DiscoveryRecord.project_id == cfg.project_id, DiscoveryRecord.org_number == org
                )
            ):
                summary["duplicate"] += 1
                continue
            reason = exclusion(row, cfg.industries)
            existing = db.scalar(
                select(Lead.id)
                .where(Lead.project_id == cfg.project_id, Lead.org_number == org)
                .limit(1)
            )
            # Never recreate a blocked or declined contact, nor an existing customer.
            status, lead_id = ("duplicate", None) if existing else ("excluded", None)
            if existing:
                reason = "Finnes allerede i prosjektet"
            if not reason:
                phone = normal_phone(row.get("telefon")) or normal_phone(row.get("mobil"))
                needs_review = not bool(phone)
                values = dict(
                    project_id=cfg.project_id,
                    partner_id=cfg.partner_id,
                    company=row["navn"][:200],
                    phone=phone,
                    org_number=org,
                    kind="b2b",
                    status="new",
                    source="brreg_discovery",
                    city="Oslo",
                    industry=str((row.get("naeringskode1") or {}).get("beskrivelse") or "")[:120],
                    call_list_id=None if needs_review else cfg.call_list_id,
                    review_required=needs_review,
                    enrichment={
                        "organization_number": org,
                        "source": "Brønnøysundregistrene / Enhetsregisteret",
                        "fetched_at": now.isoformat(),
                        "lookup_status": "pending_enrichment",
                    },
                )
                # A concurrent manual import may win. The unique index prevents duplicates.
                lead_id = db.scalar(
                    insert(Lead)
                    .values(**values)
                    .on_conflict_do_nothing(
                        index_elements=[Lead.project_id, Lead.org_number],
                        index_where=text(
                            "kind='b2b' AND org_number IS NOT NULL AND org_number <> ''"
                        ),
                    )
                    .returning(Lead.id)
                )
                if lead_id:
                    quota -= 1
                    status = "review" if needs_review else "imported"
                    reason = (
                        "Mangler gyldig norsk bedriftsnummer" if needs_review else "Lagt i Cold-kø"
                    )
                    db.execute(
                        insert(Job).values(
                            project_id=cfg.project_id,
                            partner_id=cfg.partner_id,
                            kind="brreg_enrichment",
                            payload={"lead_id": str(lead_id)},
                        )
                    )
                else:
                    status, reason = "duplicate", "Finnes allerede i prosjektet"
            db.add(
                DiscoveryRecord(
                    project_id=cfg.project_id,
                    partner_id=cfg.partner_id,
                    org_number=org,
                    company=str(row.get("navn") or org)[:200],
                    status=status,
                    reason=reason,
                    lead_id=lead_id,
                    source_url=f"{ENTITIES}/{org}",
                )
            )
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
