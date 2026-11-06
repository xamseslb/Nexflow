"""Customer profiles and manual review of completed calls."""
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from pydantic import Field
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from .api import Db, MANAGERS, OPERATORS, audit, call_history, lead_for, lead_payload, now, project_access
from .models import Call, FollowUp, Lead, Meeting, Membership, Project, QualityFlag, Sale
from .schemas import Input

router = APIRouter(prefix="/api/v1/projects/{project_id}")


class StageChange(Input):
    expected: int = Field(ge=1, le=7)
    step: int = Field(ge=1, le=7)


class FlagReason(Input):
    reason: str = Field(min_length=1, max_length=1000)


class FlagReview(Input):
    note: str = Field(min_length=1, max_length=1000)


@router.get("/customers")
def customer_directory(project_id: UUID, search: str = Query("", max_length=100),
                       page: int = Query(0, ge=0), db: Session = Db):
    project_access(db, project_id, OPERATORS)
    query = select(Lead).where(Lead.project_id == project_id)
    if value := search.strip():
        query = query.where(or_(*[field.icontains(value, autoescape=True)
                                  for field in (Lead.company, Lead.contact, Lead.phone, Lead.org_number)]))
    rows = list(db.scalars(query.order_by(func.lower(Lead.company), Lead.id).offset(page * 30).limit(31)))
    return {"items": [lead_payload(lead) for lead in rows[:30]], "has_more": len(rows) > 30}


def current_step(db: Session, lead: Lead):
    if lead.status == "sold":
        return 8
    if lead.status in {"callback", "meeting"}:
        return max(lead.pipeline_step, 5)
    assigned = db.scalar(text("""
        SELECT EXISTS (SELECT 1 FROM hub.leads l JOIN hub.call_lists q ON q.id=l.call_list_id
                       WHERE l.id=:lead AND q.assignee_id IS NOT NULL)
    """), {"lead": lead.id})
    return max(lead.pipeline_step, 2 if assigned else 1)


@router.get("/customers/{lead_id}")
def profile(project_id: UUID, lead_id: UUID, db: Session = Db):
    project_access(db, project_id, OPERATORS)
    lead = lead_for(db, project_id, lead_id)
    actor = db.info["user_id"]
    manager = db.get(Membership, (project_id, actor)).role in MANAGERS
    calls = call_history(project_id, lead_id, db)
    flags = db.scalars(select(QualityFlag).where(QualityFlag.project_id == project_id,
                       QualityFlag.call_id.in_([item["id"] for item in calls])))
    by_call = {flag.call_id: flag for flag in flags}
    for item in calls:
        flag = by_call.get(item["id"])
        item["flag_status"] = ("reviewed" if flag.reviewed_at else "open") if flag else None
    tasks = select(FollowUp).where(FollowUp.project_id == project_id, FollowUp.lead_id == lead_id,
                                   FollowUp.status == "open")
    meetings = select(Meeting).where(Meeting.project_id == project_id, Meeting.lead_id == lead_id)
    sales = select(Sale).where(Sale.project_id == project_id, Sale.lead_id == lead_id)
    if not manager:
        tasks = tasks.where(FollowUp.assignee_id == actor)
        meetings = meetings.where(or_(Meeting.booker_id == actor, Meeting.closer_id == actor))
        sales = sales.where(Sale.seller_id == actor)
    return {
        "lead": lead_payload(lead), "org_number": lead.org_number, "step": current_step(db, lead),
        "calls": calls,
        "tasks": [{"id": t.id, "title": t.title, "due_at": t.due_at}
                  for t in db.scalars(tasks.order_by(FollowUp.due_at, FollowUp.id).limit(10))],
        "meetings": [{"id": m.id, "starts_at": m.starts_at, "outcome": m.outcome}
                     for m in db.scalars(meetings.order_by(Meeting.starts_at.desc(), Meeting.id).limit(10))],
        "sales": [{"id": s.id, "created_at": s.created_at, "status": s.status, "amount_ore": s.amount_ore}
                  for s in db.scalars(sales.order_by(Sale.created_at.desc(), Sale.id).limit(10))],
    }


@router.patch("/customers/{lead_id}/stage")
def set_stage(project_id: UUID, lead_id: UUID, body: StageChange, db: Session = Db):
    project = project_access(db, project_id, OPERATORS)
    lead = lead_for(db, project_id, lead_id, lock=True)
    if not project.active or lead.status in {"sold", "declined"}:
        raise HTTPException(409, "Prosjektet eller leadet er avsluttet")
    previous = current_step(db, lead)
    if previous == body.step:
        return {"step": previous}
    if body.expected != previous:
        raise HTTPException(409, "Salgstrinnet ble endret av en annen. Oppdater kundeprofilen.")
    if body.step < previous:
        raise HTTPException(422, "Velg et senere salgstrinn")
    lead.pipeline_step = body.step
    audit(db, project, "customer.stage_changed", lead.id, {"from": previous, "to": body.step})
    return {"step": body.step}


@router.post("/customers/{lead_id}/calls/{call_id}/flag")
def flag_call(project_id: UUID, lead_id: UUID, call_id: UUID, body: FlagReason, db: Session = Db):
    project = project_access(db, project_id, OPERATORS)
    lead_for(db, project_id, lead_id, lock=True)
    actor = db.info["user_id"]
    manager = db.get(Membership, (project_id, actor)).role in MANAGERS
    call = db.scalar(select(Call).where(Call.id == call_id, Call.project_id == project_id,
                                        Call.lead_id == lead_id, Call.completed_at.is_not(None)))
    if not call or (not manager and call.user_id != actor):
        raise HTTPException(404, "Samtalen finnes ikke")
    existing = db.scalar(select(QualityFlag).where(QualityFlag.call_id == call_id))
    if existing:
        if existing.reported_by == actor and existing.reason == body.reason:
            return {"id": existing.id}
        raise HTTPException(409, "Samtalen er allerede flagget")
    flag = QualityFlag(project_id=project_id, partner_id=project.partner_id, call_id=call_id,
                       reported_by=actor, reason=body.reason)
    db.add(flag)
    db.flush()
    audit(db, project, "quality.reported", flag.id)
    return {"id": flag.id}


@router.get("/quality-flags")
def quality_queue(project_id: UUID, reviewed: bool = False, page: int = Query(0, ge=0), db: Session = Db):
    project_access(db, project_id, MANAGERS)
    query = (select(QualityFlag, Call, Lead.company).join(Call, Call.id == QualityFlag.call_id)
             .join(Lead, Lead.id == Call.lead_id)
             .where(QualityFlag.project_id == project_id,
                    QualityFlag.reviewed_at.is_not(None) if reviewed else QualityFlag.reviewed_at.is_(None))
             .order_by(QualityFlag.created_at.desc(), QualityFlag.id).offset(page * 30).limit(31))
    rows = list(db.execute(query))
    return {"items": [{"id": flag.id, "lead_id": call.lead_id, "company": company, "reason": flag.reason,
                       "created_at": flag.created_at, "call_note": call.note, "call_outcome": call.outcome,
                       "reviewed_at": flag.reviewed_at, "review_note": flag.review_note}
                      for flag, call, company in rows[:30]], "has_more": len(rows) > 30}


@router.patch("/quality-flags/{flag_id}")
def review_flag(project_id: UUID, flag_id: UUID, body: FlagReview, db: Session = Db):
    project = project_access(db, project_id, MANAGERS)
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key,0))"), {"key": f"quality:{flag_id}"})
    flag = db.scalar(select(QualityFlag).where(QualityFlag.project_id == project_id, QualityFlag.id == flag_id))
    if not flag:
        raise HTTPException(404, "Saken finnes ikke")
    if flag.reviewed_at:
        if flag.reviewed_by == db.info["user_id"] and flag.review_note == body.note:
            return {"id": flag.id, "reviewed_at": flag.reviewed_at}
        raise HTTPException(409, "Saken er allerede gjennomgått")
    flag.reviewed_by, flag.review_note, flag.reviewed_at = db.info["user_id"], body.note, now()
    audit(db, project, "quality.reviewed", flag.id)
    return {"id": flag.id, "reviewed_at": flag.reviewed_at}


class ProjectTypeChange(Input):
    project_type: str = Field(max_length=80)
    expected: str | None = Field(default=None, max_length=80)


@router.patch("/settings")
def update_project_type(project_id: UUID, body: ProjectTypeChange, db: Session = Db):
    project_access(db, project_id, MANAGERS)
    project = db.get(Project, project_id, with_for_update=True, populate_existing=True)
    if project.project_type != body.project_type:
        if body.expected is not None and body.expected != project.project_type:
            raise HTTPException(409, "Prosjekttypen er endret av en annen. Last inn prosjektet på nytt.")
        old = project.project_type
        project.project_type = body.project_type
        audit(db, project, "project.type_changed", project.id, {"from": old, "to": body.project_type})
    return {"project_type": project.project_type}
