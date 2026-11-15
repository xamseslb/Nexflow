"""Project-scoped lead reads, creation, import and public enrichment fields."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .company_registry import public_facts
from .models import Job, Lead
from .project_access import MANAGERS, OPERATORS, Db, audit, lead_for, project_access
from .schemas import ImportLeads, LeadCreate

router = APIRouter(prefix="/api/v1")


def lead_payload(lead: Lead):
    payload = {
        key: getattr(lead, key)
        for key in (
            "id",
            "project_id",
            "call_list_id",
            "company",
            "contact",
            "phone",
            "kind",
            "status",
            "priority",
            "industry",
            "city",
            "summary",
            "blocked",
            "reserved_by",
            "reserved_until",
            "callback_at",
        )
    }
    info = lead.enrichment if lead.kind == "b2b" and isinstance(lead.enrichment, dict) else {}
    return {**payload, "review_required": lead.review_required, "enrichment": public_facts(info)}


@router.get("/projects/{project_id}/leads")
def leads(project_id: UUID, search: str = Query(default="", max_length=100), db: Session = Db):
    project_access(db, project_id)
    query = select(Lead).where(Lead.project_id == project_id)
    if search:
        query = query.where(
            Lead.company.icontains(search, autoescape=True)
            | Lead.contact.icontains(search, autoescape=True)
        )
    return [
        lead_payload(x)
        for x in db.scalars(query.order_by(Lead.priority.desc(), Lead.created_at).limit(500))
    ]


@router.get("/projects/{project_id}/leads/{lead_id}")
def get_lead(project_id: UUID, lead_id: UUID, db: Session = Db):
    project_access(db, project_id)
    return lead_payload(lead_for(db, project_id, lead_id))


@router.post("/projects/{project_id}/leads", status_code=201)
def create_lead(project_id: UUID, body: LeadCreate, db: Session = Db):
    project = project_access(db, project_id, OPERATORS)
    if not project.active or project.kind not in (body.kind, "both"):
        raise HTTPException(422, "Kontakttypen er ikke tillatt i dette aktive prosjektet")
    lead = Lead(project_id=project.id, partner_id=project.partner_id, **body.model_dump())
    try:
        with db.begin_nested():
            db.add(lead)
            db.flush()
    except IntegrityError as exc:
        if getattr(getattr(exc.orig, "diag", None), "constraint_name", None) == "lead_project_org":
            raise HTTPException(409, "Bedriften finnes allerede i prosjektet") from None
        raise
    if lead.kind == "b2b":
        db.execute(
            Job.__table__.insert()
            .inline()
            .values(
                project_id=project.id,
                partner_id=project.partner_id,
                kind="brreg_enrichment",
                payload={"lead_id": str(lead.id)},
            )
        )
    audit(db, project, "lead.created", lead.id)
    return lead_payload(lead)


@router.post("/projects/{project_id}/imports", status_code=201)
def import_leads(project_id: UUID, body: ImportLeads, db: Session = Db):
    project_access(db, project_id, MANAGERS)
    return {"created": len([create_lead(project_id, row, db) for row in body.rows])}
