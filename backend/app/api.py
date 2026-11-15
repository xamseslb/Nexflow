"""Current user, project directory, team membership and assignment transfers."""

from uuid import UUID

from fastapi import APIRouter, HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .models import CallList, Lead, Membership, Project
from .project_access import MANAGERS, Db, audit, project_access
from .schemas import MoveAssignment

router = APIRouter(prefix="/api/v1")


@router.get("/me")
def me(db: Session = Db):
    return {"id": db.info["user_id"]}


@router.get("/projects")
def projects(db: Session = Db):
    return [
        {
            "id": p.id,
            "name": p.name,
            "description": p.description,
            "active": p.active,
            "kind": p.kind,
            "project_type": p.project_type,
            "partner_id": p.partner_id,
            "role": db.get(Membership, (p.id, db.info["user_id"])).role,
        }
        for p in db.scalars(
            select(Project)
            .join(Membership, Membership.project_id == Project.id)
            .where(Membership.user_id == db.info["user_id"], Membership.active.is_(True))
            .order_by(Project.name)
        )
    ]


@router.get("/projects/{project_id}/team")
def team(project_id: UUID, db: Session = Db):
    project_access(db, project_id, MANAGERS)
    return [
        dict(row)
        for row in db.execute(
            text(
                "SELECT id, name, role FROM hub_private.team_directory(:project) WHERE active ORDER BY name, id"
            ),
            {"project": project_id},
        ).mappings()
    ]


@router.post("/projects/{project_id}/assignments/move")
def move_assignment(project_id: UUID, body: MoveAssignment, db: Session = Db):
    source = project_access(db, project_id, MANAGERS)
    target = project_access(db, body.target_project_id, MANAGERS)
    if source.id == target.id or not target.active:
        raise HTTPException(422, "Velg et annet aktivt prosjekt")
    if source.move_rule != "release":
        raise HTTPException(
            409, "Flytting med leads krever avklart eierskap og samtykke; bruk frigjøring"
        )
    # Serialize moves of the same seller, including different source projects.
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": str(body.user_id)}
    )
    member = db.get(Membership, (project_id, body.user_id), with_for_update=True)
    if not member or not member.active or member.role not in {"seller", "booker", "closer"}:
        raise HTTPException(422, "Velg en aktiv selger, booker eller closer")
    destination = db.get(Membership, (target.id, body.user_id))
    if destination and destination.active:
        raise HTTPException(409, "Brukeren er allerede tildelt målprosjektet")
    for lead in db.scalars(
        select(Lead)
        .where(Lead.project_id == project_id, Lead.reserved_by == body.user_id)
        .with_for_update()
    ):
        lead.reserved_by = lead.reserved_until = None
    for queue in db.scalars(
        select(CallList)
        .where(CallList.project_id == project_id, CallList.assignee_id == body.user_id)
        .with_for_update()
    ):
        queue.assignee_id = None
    if destination:
        destination.active, destination.role = True, member.role
    else:
        db.add(
            Membership(project_id=target.id, user_id=body.user_id, role=member.role, active=True)
        )
    member.active = False
    audit(db, source, "assignment.ended", body.user_id, {"target_project_id": str(target.id)})
    audit(db, target, "assignment.started", body.user_id, {"source_project_id": str(source.id)})
    return {"moved": True}
