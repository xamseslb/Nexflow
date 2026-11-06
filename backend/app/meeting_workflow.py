"""Closers record the outcome of their completed appointments."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from .api import Db, audit, project_access
from .schemas import Input

router = APIRouter(prefix="/api/v1/projects/{project_id}")


class MeetingResult(Input):
    outcome: Literal["qualified", "not_qualified", "no_show", "offer_sent", "sold"]


@router.patch("/meetings/{meeting_id}/outcome")
def record_meeting_result(project_id: UUID, meeting_id: UUID, body: MeetingResult, db: Session = Db):
    project = project_access(db, project_id, {"closer", "leader", "admin"})
    # The closer may have appointment access while another seller owns the underlying lead.
    result = db.scalar(text("SELECT hub_private.complete_meeting(:project,:meeting,:outcome)"),
                       {"project": project_id, "meeting": meeting_id, "outcome": body.outcome})
    if result == "missing":
        raise HTTPException(404, "Møtet finnes ikke blant dine møter som closer")
    if result == "finalized":
        raise HTTPException(409, "Møteutfallet er allerede registrert")
    if result == "future":
        raise HTTPException(422, "Møteutfall kan registreres etter møtets slutt")
    if result == "missing_sale":
        raise HTTPException(409, "Registrer salget på leadkortet før du velger salg som møteutfall")
    if result not in {"saved", "already_saved"}:
        raise HTTPException(422, "Ugyldig møteutfall")
    if result == "saved":
        audit(db, project, "meeting.completed", meeting_id, {"outcome": body.outcome})
    return {"id": meeting_id, "outcome": body.outcome}
