"""Manager allocation and transactional, seller-scoped calling queues."""
from datetime import timedelta
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import Field
from sqlalchemy import and_, case, exists, func, or_, select, text
from sqlalchemy.orm import Session

from .api import Db, MANAGERS, OPERATORS, audit, lead_payload, lock_operator, now, project_access
from .models import CallList, Consent, Lead, Membership, RegistryCheck
from .schemas import Input

router = APIRouter(prefix="/api/v1/projects/{project_id}/call-lists")


class ListCreate(Input):
    name: str = Field(min_length=1, max_length=100)
    category: Literal["hot", "cold", "winback"]
    assignee_id: UUID | None = None


class ListAssignment(Input):
    assignee_id: UUID | None


class ListLeads(Input):
    lead_ids: list[UUID] = Field(min_length=1, max_length=500)


def payload(queue, count):
    return {"id": queue.id, "name": queue.name, "category": queue.category,
            "assignee_id": queue.assignee_id, "lead_count": count}


def access_list(db, project_id, list_id, write=False):
    if write:
        # Same lock for manager mutations and next-contact retries by a seller.
        db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
                   {"key": f"call-list:{project_id}:{list_id}"})
    queue = db.scalar(select(CallList).where(CallList.project_id == project_id, CallList.id == list_id))
    role = db.get(Membership, (project_id, db.info["user_id"])).role
    if not queue or (role not in MANAGERS and queue.assignee_id != db.info["user_id"]):
        raise HTTPException(404, "Ringelisten finnes ikke i arbeidsområdet ditt")
    return queue


def validate_assignee(db, project_id, assignee):
    if assignee is None:
        return
    member = db.scalar(select(Membership).where(Membership.project_id == project_id,
                       Membership.user_id == assignee).with_for_update(read=True))
    if not member or not member.active or member.role not in OPERATORS:
        raise HTTPException(422, "Velg en aktiv selger i prosjektet")


def active_project(db, project_id, roles):
    project = project_access(db, project_id, roles)
    if not project.active:
        raise HTTPException(409, "Prosjektet er pauset")
    return project


@router.get("")
def lists(project_id: UUID, db: Session = Db):
    project_access(db, project_id, OPERATORS)
    query = (select(CallList, func.count(Lead.id)).outerjoin(Lead, Lead.call_list_id == CallList.id)
             .where(CallList.project_id == project_id).group_by(CallList.id).order_by(CallList.name, CallList.id))
    if db.get(Membership, (project_id, db.info["user_id"])).role not in MANAGERS:
        query = query.where(CallList.assignee_id == db.info["user_id"])
    return [payload(queue, count) for queue, count in db.execute(query)]


@router.post("", status_code=201)
def create_list(project_id: UUID, body: ListCreate, db: Session = Db):
    project = active_project(db, project_id, MANAGERS)
    validate_assignee(db, project_id, body.assignee_id)
    queue = CallList(project_id=project_id, partner_id=project.partner_id, **body.model_dump())
    db.add(queue)
    db.flush()
    audit(db, project, "call_list.created", queue.id)
    return payload(queue, 0)


@router.patch("/{list_id}")
def assign_list(project_id: UUID, list_id: UUID, body: ListAssignment, db: Session = Db):
    project = active_project(db, project_id, MANAGERS)
    queue = access_list(db, project_id, list_id, write=True)
    validate_assignee(db, project_id, body.assignee_id)
    members = select(Lead).where(Lead.project_id == project_id, Lead.call_list_id == list_id)
    if queue.assignee_id != body.assignee_id:
        # Serialize direct lead operations, including an in-flight call authorization.
        for lead in db.scalars(members.order_by(Lead.id).with_for_update()):
            if lead.reserved_until and lead.reserved_until > now():
                raise HTTPException(409, "En kontakt er i bruk. Avslutt ringeøkten før du endrer tildelingen.")
        queue.assignee_id = body.assignee_id
        audit(db, project, "call_list.assigned", list_id, {"assignee_id": str(body.assignee_id) if body.assignee_id else None})
    count = db.scalar(select(func.count(Lead.id)).where(Lead.call_list_id == list_id))
    return payload(queue, count)


@router.get("/{list_id}/leads")
def list_leads(project_id: UUID, list_id: UUID, db: Session = Db):
    project_access(db, project_id, OPERATORS)
    access_list(db, project_id, list_id)
    leads = db.scalars(select(Lead).where(Lead.project_id == project_id, Lead.call_list_id == list_id)
                       .order_by(Lead.priority.desc(), Lead.created_at, Lead.id))
    return [lead_payload(lead) for lead in leads]


@router.post("/{list_id}/leads")
def move_leads(project_id: UUID, list_id: UUID, body: ListLeads, db: Session = Db):
    project = active_project(db, project_id, MANAGERS)
    queue = access_list(db, project_id, list_id, write=True)
    ids = set(body.lead_ids)
    leads = list(db.scalars(select(Lead).where(Lead.project_id == project_id, Lead.id.in_(ids))
                            .order_by(Lead.id).with_for_update()))
    if len(leads) != len(ids):
        raise HTTPException(404, "Ett eller flere leads finnes ikke i prosjektet")
    for lead in leads:
        if lead.call_list_id == list_id:
            continue
        if lead.reserved_until and lead.reserved_until > now():
            raise HTTPException(409, "Et valgt lead er reservert. Avslutt ringeøkten før flytting.")
        if lead.status == "declined" and queue.category == "winback" and not lead.blocked:
            lead.status = "new"
            lead.callback_at = None
        lead.call_list_id = list_id
        lead.queue_completed_at = lead.reserved_by = lead.reserved_until = None
        audit(db, project, "lead.list_changed", lead.id, {"call_list_id": str(list_id)})
    return {"updated": len(leads)}


@router.post("/{list_id}/next")
def next_contact(project_id: UUID, list_id: UUID, db: Session = Db):
    lock_operator(db)
    project = active_project(db, project_id, OPERATORS)
    access_list(db, project_id, list_id, write=True)
    current = now()
    uid = db.info["user_id"]
    # Match the latest registry record, even if an older record allowed calling.
    latest_check = (select(RegistryCheck.checked_at, RegistryCheck.reserved)
                    .where(RegistryCheck.lead_id == Lead.id, RegistryCheck.phone == Lead.phone)
                    .order_by(RegistryCheck.checked_at.desc(), RegistryCheck.id.desc()).limit(1)
                    .correlate(Lead).subquery())
    clear_check = exists(select(1).select_from(latest_check).where(
        latest_check.c.checked_at > current - timedelta(days=30), latest_check.c.checked_at <= current,
        latest_check.c.reserved.is_(False)))
    consent = exists(select(Consent.id).where(Consent.lead_id == Lead.id, Consent.partner_id == project.partner_id,
        Consent.phone == Lead.phone, Consent.revoked_at.is_(None), Consent.granted_at <= current,
        Consent.expires_at > current, Consent.evidence != ""))
    held = and_(Lead.reserved_by == uid, Lead.reserved_until > current)
    query = select(Lead).where(
        Lead.project_id == project_id, Lead.call_list_id == list_id, Lead.queue_completed_at.is_(None),
        Lead.blocked.is_(False), Lead.review_required.is_(False), Lead.phone != "", Lead.status.in_(("new", "callback")),
        or_(Lead.status != "callback", Lead.callback_at.is_(None), Lead.callback_at <= current),
        or_(Lead.reserved_by.is_(None), Lead.reserved_until.is_(None), Lead.reserved_until <= current, held),
        or_(Lead.kind == "b2b", and_(Lead.kind == "b2c", or_(consent, clear_check))),
    ).order_by(case((held, 0), else_=1), Lead.callback_at.asc().nulls_last(), Lead.priority.desc(),
               Lead.created_at, Lead.id).limit(1).with_for_update(skip_locked=True)
    lead = db.scalar(query)
    if lead is None:
        return {"lead": None}
    if lead.reserved_by != uid or not lead.reserved_until or lead.reserved_until <= current:
        lead.reserved_by, lead.reserved_until = uid, current + timedelta(minutes=15)
        audit(db, project, "lead.reserved", lead.id, {"call_list_id": str(list_id)})
    return {"lead": lead_payload(lead)}

