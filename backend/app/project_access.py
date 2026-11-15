"""Shared membership checks, transaction locks and audit records for CRM operations."""

from datetime import datetime, timezone
from uuid import UUID

from fastapi import Depends, HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .db import session
from .models import AuditEvent, Lead, Membership, Project

# Commit or roll back the transaction before the client receives an HTTP success.
Db = Depends(session, scope="function")
OPERATORS = {"seller", "booker", "closer", "leader", "admin"}
MANAGERS = {"leader", "admin"}


def now():
    return datetime.now(timezone.utc)


def lock_operator(db: Session):
    # Membership moves/revocations use the same transaction lock before releasing leases.
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": str(db.info["user_id"])},
    )


def project_access(db: Session, project_id: UUID, roles: set[str] | None = None) -> Project:
    member = db.get(Membership, (project_id, db.info["user_id"]))
    if not member or not member.active or (roles and member.role not in roles):
        raise HTTPException(403, "Du har ikke tilgang til dette prosjektet")
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(403, "Du har ikke tilgang til dette prosjektet")
    return project


def lead_for(db: Session, project_id: UUID, lead_id: UUID, lock=False) -> Lead:
    query = select(Lead).where(Lead.project_id == project_id, Lead.id == lead_id)
    if lock:
        query = query.with_for_update()
    lead = db.scalar(query)
    if lead is None:
        raise HTTPException(404, "Lead finnes ikke i prosjektet")
    return lead


def audit(db: Session, project: Project, action: str, entity_id: UUID, details=None):
    db.add(
        AuditEvent(
            partner_id=project.partner_id,
            project_id=project.id,
            actor_id=db.info["user_id"],
            action=action,
            entity_id=entity_id,
            details=details or {},
        )
    )
