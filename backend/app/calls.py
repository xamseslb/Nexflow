"""Reserve leads, evaluate calling eligibility and record the outcome of a call."""

from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .domain import Eligibility, can_call
from .models import AuditEvent, Call, Consent, Lead, Membership, Project, RegistryCheck
from .project_access import (
    MANAGERS,
    OPERATORS,
    Db,
    audit,
    lead_for,
    lock_operator,
    now,
    project_access,
)
from .schemas import CallResult

router = APIRouter(prefix="/api/v1")


def eligibility(db: Session, project: Project, lead: Lead):
    current = now()
    # Match evidence to the current phone number. Changing a number invalidates earlier checks.
    check = db.scalar(
        select(RegistryCheck)
        .where(RegistryCheck.lead_id == lead.id, RegistryCheck.phone == lead.phone)
        .order_by(RegistryCheck.checked_at.desc(), RegistryCheck.id.desc())
        .limit(1)
    )
    consent = db.scalar(
        select(Consent.id)
        .where(
            Consent.lead_id == lead.id,
            Consent.partner_id == project.partner_id,
            Consent.phone == lead.phone,
            Consent.revoked_at.is_(None),
            Consent.granted_at <= current,
            Consent.expires_at > current,
            Consent.evidence != "",
        )
        .limit(1)
    )
    decision = can_call(
        active=project.active,
        blocked=lead.blocked,
        kind=lead.kind,
        reserved_by=lead.reserved_by,
        reserved_until=lead.reserved_until,
        user_id=db.info["user_id"],
        now=current,
        checked_at=check.checked_at if check else None,
        registry_reserved=check.reserved if check else None,
        consent_valid=consent is not None,
    )
    if lead.status in ("sold", "declined"):
        decision = Eligibility(False, "Leadet er avsluttet")
    elif lead.review_required or not lead.phone.strip():
        decision = Eligibility(False, "Bedriftsnummeret må kontrolleres før kontakten kan ringes")
    elif (
        lead.call_list_id
        and lead.status == "callback"
        and lead.callback_at
        and lead.callback_at > current
    ):
        decision = Eligibility(False, "Tilbakekallingen er planlagt til et senere tidspunkt")
    return decision, {
        "allowed": decision.allowed,
        "reason": decision.reason,
        "evaluated_at": current.isoformat(),
        "registry_check_id": str(check.id) if check else None,
        "consent_id": str(consent) if consent else None,
        "rule_version": 1,
    }


@router.post("/projects/{project_id}/leads/{lead_id}/reserve")
def reserve(project_id: UUID, lead_id: UUID, db: Session = Db):
    lock_operator(db)
    project = project_access(db, project_id, OPERATORS)
    if not project.active:
        raise HTTPException(409, "Prosjektet er pauset")
    lead = lead_for(db, project_id, lead_id, lock=True)
    current = now()
    if lead.status in ("sold", "declined"):
        raise HTTPException(409, "Leadet er avsluttet")
    if (
        lead.reserved_by not in (None, db.info["user_id"])
        and lead.reserved_until
        and lead.reserved_until > current
    ):
        raise HTTPException(409, "Leadet er allerede reservert")
    lead.reserved_by = db.info["user_id"]
    lead.reserved_until = current + timedelta(minutes=15)
    audit(db, project, "lead.reserved", lead.id)
    return {"reserved_until": lead.reserved_until}


@router.delete("/projects/{project_id}/leads/{lead_id}/reservation", status_code=204)
def release(project_id: UUID, lead_id: UUID, db: Session = Db):
    lock_operator(db)
    project = project_access(db, project_id, OPERATORS)
    lead = lead_for(db, project_id, lead_id, lock=True)
    if lead.reserved_by != db.info["user_id"]:
        raise HTTPException(403, "Du kan bare frigjøre egne reservasjoner")
    for pending in db.scalars(open_calls(db, project_id, lead_id)):
        audit(db, project, "call.abandoned", pending.id)
    lead.reserved_by = lead.reserved_until = None
    audit(db, project, "lead.released", lead.id)


def open_calls(db: Session, project_id: UUID, lead_id: UUID):
    abandoned = (
        select(AuditEvent.entity_id)
        .where(
            AuditEvent.project_id == project_id,
            AuditEvent.action == "call.abandoned",
            AuditEvent.entity_id == Call.id,
        )
        .exists()
    )
    return select(Call).where(
        Call.project_id == project_id,
        Call.lead_id == lead_id,
        Call.user_id == db.info["user_id"],
        Call.completed_at.is_(None),
        ~abandoned,
    )


@router.get("/projects/{project_id}/leads/{lead_id}/eligibility")
def get_eligibility(project_id: UUID, lead_id: UUID, db: Session = Db):
    project = project_access(db, project_id, OPERATORS)
    _, evidence = eligibility(db, project, lead_for(db, project_id, lead_id))
    return evidence


@router.get("/projects/{project_id}/leads/{lead_id}/call-history")
def call_history(project_id: UUID, lead_id: UUID, db: Session = Db):
    project_access(db, project_id, OPERATORS)
    lead = lead_for(db, project_id, lead_id)
    query = select(Call).where(
        Call.project_id == project_id, Call.lead_id == lead_id, Call.completed_at.is_not(None)
    )
    membership = db.get(Membership, (project_id, db.info["user_id"]))
    # Listed leads are only visible to the assigned operator or a manager.
    # An explicit handover includes prior notes; the legacy shared pool remains personal.
    manager = membership.role in MANAGERS
    if not manager and lead.call_list_id is None:
        query = query.where(Call.user_id == db.info["user_id"])
    calls = db.scalars(query.order_by(Call.completed_at.desc(), Call.id.desc()).limit(10))
    return [
        {
            "id": call.id,
            "completed_at": call.completed_at,
            "outcome": call.outcome,
            "note": call.note,
            "can_flag": manager or call.user_id == db.info["user_id"],
        }
        for call in calls
    ]


@router.post("/projects/{project_id}/leads/{lead_id}/call-authorization", status_code=201)
def authorize_call(project_id: UUID, lead_id: UUID, db: Session = Db):
    lock_operator(db)
    project = project_access(db, project_id, OPERATORS)
    lead = lead_for(db, project_id, lead_id, lock=True)
    if lead.status in ("sold", "declined"):
        raise HTTPException(409, "Leadet er avsluttet")
    decision, evidence = eligibility(db, project, lead)
    if not decision.allowed:
        raise HTTPException(409, decision.reason)
    if (
        lead.reserved_by == db.info["user_id"]
        and lead.reserved_until
        and lead.reserved_until > now()
    ):
        previous = db.scalar(
            open_calls(db, project_id, lead_id)
            .where(Call.created_at >= now() - timedelta(minutes=15))
            .order_by(Call.created_at.desc(), Call.id.desc())
            .limit(1)
        )
        if previous:
            return {"id": previous.id, "phone": lead.phone, "expires_at": lead.reserved_until}
    lead.reserved_by, lead.reserved_until = db.info["user_id"], now() + timedelta(minutes=15)
    call = Call(
        project_id=project.id,
        partner_id=project.partner_id,
        lead_id=lead.id,
        user_id=db.info["user_id"],
        authorization=evidence,
        created_at=now(),
    )
    db.add(call)
    db.flush()
    audit(db, project, "call.authorized", call.id, evidence)
    return {"id": call.id, "phone": lead.phone, "expires_at": lead.reserved_until}


@router.patch("/projects/{project_id}/calls/{call_id}")
def complete_call(project_id: UUID, call_id: UUID, body: CallResult, db: Session = Db):
    lock_operator(db)
    project = project_access(db, project_id, OPERATORS)
    call = db.scalar(
        select(Call).where(Call.id == call_id, Call.project_id == project_id).with_for_update()
    )
    if not call or call.user_id != db.info["user_id"]:
        raise HTTPException(404, "Samtalen finnes ikke")
    if call.completed_at:
        if (call.outcome, call.note, call.callback_at) == (
            body.outcome,
            body.note,
            body.callback_at,
        ):
            return {"id": call.id, "outcome": call.outcome}
        raise HTTPException(409, "Utfallet er allerede registrert")
    latest = db.scalar(
        select(Call.id)
        .where(Call.project_id == project_id, Call.lead_id == call.lead_id)
        .order_by(Call.created_at.desc(), Call.id.desc())
        .limit(1)
    )
    if (
        latest != call.id
        or db.scalar(open_calls(db, project_id, call.lead_id).where(Call.id == call.id)) is None
    ):
        raise HTTPException(409, "Ringeøkten er avsluttet. Start en ny samtale.")
    if body.outcome == "callback" and (body.callback_at is None or body.callback_at <= now()):
        raise HTTPException(422, "Velg et fremtidig tidspunkt for tilbakekalling")
    lead = lead_for(db, project_id, call.lead_id, lock=True)
    if (
        lead.reserved_by != db.info["user_id"]
        or not lead.reserved_until
        or lead.reserved_until <= now()
    ):
        raise HTTPException(
            409, "Reservasjonen er utløpt. Reserver leadet på nytt før utfallet lagres."
        )
    call.outcome, call.note, call.completed_at = body.outcome, body.note, now()
    call.callback_at = body.callback_at
    if lead.call_list_id:
        lead.queue_completed_at = None if body.outcome == "callback" else call.completed_at
        if body.outcome != "callback":
            lead.callback_at = None
            if lead.status == "callback":
                lead.status = "new"
    # A call outcome never substitutes for an actual sale or meeting record.
    if body.outcome in ("declined", "callback") and lead.status not in ("sold", "meeting"):
        lead.status = body.outcome
    if body.outcome == "callback":
        lead.callback_at = body.callback_at
    if lead.reserved_by == db.info["user_id"]:
        lead.reserved_by = lead.reserved_until = None
    audit(db, project, "call.completed", call.id, {"outcome": body.outcome})
    return {"id": call.id, "outcome": call.outcome}
