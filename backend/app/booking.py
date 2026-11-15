"""Book project meetings and look up eligible closers."""

from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .models import Meeting
from .project_access import OPERATORS, Db, audit, lead_for, now, project_access
from .schemas import MeetingCreate

router = APIRouter(prefix="/api/v1")


@router.get("/projects/{project_id}/meetings")
def meetings(project_id: UUID, db: Session = Db):
    project_access(db, project_id)
    return [
        {
            "id": m.id,
            "lead_id": m.lead_id,
            "starts_at": m.starts_at,
            "ends_at": m.ends_at,
            "closer_id": m.closer_id,
            "outcome": m.outcome,
            "qualification": m.qualification,
            "can_record_outcome": m.closer_id == db.info["user_id"],
        }
        for m in db.scalars(
            select(Meeting)
            .where(Meeting.project_id == project_id)
            .order_by(Meeting.starts_at)
            .limit(500)
        )
    ]


@router.get("/projects/{project_id}/closers")
def closers(project_id: UUID, db: Session = Db):
    project_access(db, project_id, OPERATORS)
    return [
        dict(row)
        for row in db.execute(
            text("SELECT * FROM hub_private.project_closers(:project)"), {"project": project_id}
        ).mappings()
    ]


@router.post("/projects/{project_id}/meetings", status_code=201)
def book_meeting(project_id: UUID, body: MeetingCreate, db: Session = Db):
    project = project_access(db, project_id, OPERATORS)
    lead = lead_for(db, project_id, body.lead_id, lock=True)
    closer_role = db.scalar(
        text("SELECT hub_private.closer_allowed(:project, :closer)"),
        {"project": project_id, "closer": body.closer_id},
    )
    if not closer_role:
        raise HTTPException(422, "Closeren er ikke tildelt prosjektet")
    if (
        body.starts_at <= now()
        or body.ends_at <= body.starts_at
        or body.ends_at - body.starts_at > timedelta(hours=8)
    ):
        raise HTTPException(422, "Velg et gyldig fremtidig møtetidspunkt")
    if not project.active or lead.status in ("sold", "declined"):
        raise HTTPException(409, "Leadet er ikke tilgjengelig for booking")
    if (
        lead.reserved_by != db.info["user_id"]
        or not lead.reserved_until
        or lead.reserved_until <= now()
    ):
        raise HTTPException(409, "Reserver leadet før booking")
    meeting = Meeting(
        project_id=project.id,
        partner_id=project.partner_id,
        booker_id=db.info["user_id"],
        **body.model_dump(),
    )
    # The database checks for overlapping bookings across projects, including simultaneous inserts.
    db.add(meeting)
    db.flush()
    lead.status, lead.reserved_by, lead.reserved_until = "meeting", None, None
    audit(db, project, "meeting.booked", meeting.id)
    return {"id": meeting.id}
