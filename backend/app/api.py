import csv
import io
from datetime import datetime, timedelta, timezone
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from .db import session
from .domain import allocate, can_call, can_approve
from .models import Project, Membership, Lead, Call, RegistryCheck, Consent, Product, Sale, Meeting, AuditEvent, Job
from .schemas import LeadCreate, ImportLeads, CallResult, SaleCreate, MeetingCreate, MoveAssignment

router = APIRouter(prefix="/api/v1")
Db = Depends(session, scope="function")
OPERATORS = {"seller", "booker", "closer", "leader", "admin"}
MANAGERS = {"leader", "admin"}


def now():
    return datetime.now(timezone.utc)


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
    db.add(AuditEvent(partner_id=project.partner_id, project_id=project.id,
                      actor_id=db.info["user_id"], action=action, entity_id=entity_id, details=details or {}))


def eligibility(db: Session, project: Project, lead: Lead):
    current = now()
    check = db.scalar(select(RegistryCheck).where(RegistryCheck.lead_id == lead.id, RegistryCheck.phone == lead.phone)
                      .order_by(RegistryCheck.checked_at.desc()).limit(1))
    consent = db.scalar(select(Consent.id).where(
        Consent.lead_id == lead.id, Consent.partner_id == project.partner_id,
        Consent.phone == lead.phone, Consent.revoked_at.is_(None), Consent.granted_at <= current,
        Consent.expires_at > current, Consent.evidence != "").limit(1))
    decision = can_call(active=project.active, blocked=lead.blocked, kind=lead.kind,
                        reserved_by=lead.reserved_by, reserved_until=lead.reserved_until,
                        user_id=db.info["user_id"], now=current,
                        checked_at=check.checked_at if check else None,
                        registry_reserved=check.reserved if check else None, consent_valid=consent is not None)
    return decision, {"allowed": decision.allowed, "reason": decision.reason, "evaluated_at": current.isoformat(),
                      "registry_check_id": str(check.id) if check else None,
                      "consent_id": str(consent) if consent else None, "rule_version": 1}


def lead_payload(lead: Lead):
    return {key: getattr(lead, key) for key in ("id", "project_id", "company", "contact", "phone", "kind", "status", "priority", "industry", "city", "summary", "enrichment", "blocked", "reserved_by", "reserved_until", "callback_at")}


@router.get("/me")
def me(db: Session = Db):
    return {"id": db.info["user_id"]}


@router.get("/projects")
def projects(db: Session = Db):
    return [{"id": p.id, "name": p.name, "description": p.description, "active": p.active, "kind": p.kind,
             "partner_id": p.partner_id, "role": db.get(Membership, (p.id, db.info["user_id"])).role}
            for p in db.scalars(select(Project).order_by(Project.name))]


@router.get("/projects/{project_id}/leads")
def leads(project_id: UUID, search: str = Query(default="", max_length=100), db: Session = Db):
    project_access(db, project_id)
    query = select(Lead).where(Lead.project_id == project_id)
    if search:
        query = query.where(Lead.company.icontains(search, autoescape=True) | Lead.contact.icontains(search, autoescape=True))
    return [lead_payload(x) for x in db.scalars(query.order_by(Lead.priority.desc(), Lead.created_at).limit(500))]


@router.post("/projects/{project_id}/leads", status_code=201)
def create_lead(project_id: UUID, body: LeadCreate, db: Session = Db):
    project = project_access(db, project_id, OPERATORS)
    if not project.active or project.kind not in (body.kind, "both"):
        raise HTTPException(422, "Kontakttypen er ikke tillatt i dette aktive prosjektet")
    lead = Lead(project_id=project.id, partner_id=project.partner_id, **body.model_dump())
    db.add(lead)
    db.flush()
    if lead.kind == "b2b" and lead.org_number:
        db.add(Job(project_id=project.id, partner_id=project.partner_id, kind="brreg_enrichment", payload={"lead_id": str(lead.id)}))
    audit(db, project, "lead.created", lead.id)
    return lead_payload(lead)


@router.post("/projects/{project_id}/imports", status_code=201)
def import_leads(project_id: UUID, body: ImportLeads, db: Session = Db):
    project_access(db, project_id, MANAGERS)
    return {"created": len([create_lead(project_id, row, db) for row in body.rows])}


@router.post("/projects/{project_id}/leads/{lead_id}/reserve")
def reserve(project_id: UUID, lead_id: UUID, db: Session = Db):
    project = project_access(db, project_id, OPERATORS)
    if not project.active:
        raise HTTPException(409, "Prosjektet er pauset")
    lead = lead_for(db, project_id, lead_id, lock=True)
    current = now()
    if lead.status in ("sold", "declined"):
        raise HTTPException(409, "Leadet er avsluttet")
    if lead.reserved_by not in (None, db.info["user_id"]) and lead.reserved_until and lead.reserved_until > current:
        raise HTTPException(409, "Leadet er allerede reservert")
    lead.reserved_by = db.info["user_id"]
    lead.reserved_until = current + timedelta(minutes=15)
    audit(db, project, "lead.reserved", lead.id)
    return {"reserved_until": lead.reserved_until}


@router.delete("/projects/{project_id}/leads/{lead_id}/reservation", status_code=204)
def release(project_id: UUID, lead_id: UUID, db: Session = Db):
    project = project_access(db, project_id, OPERATORS)
    lead = lead_for(db, project_id, lead_id, lock=True)
    if lead.reserved_by != db.info["user_id"]:
        raise HTTPException(403, "Du kan bare frigjøre egne reservasjoner")
    lead.reserved_by = lead.reserved_until = None
    audit(db, project, "lead.released", lead.id)


@router.get("/projects/{project_id}/leads/{lead_id}/eligibility")
def get_eligibility(project_id: UUID, lead_id: UUID, db: Session = Db):
    project = project_access(db, project_id, OPERATORS)
    _, evidence = eligibility(db, project, lead_for(db, project_id, lead_id))
    return evidence


@router.post("/projects/{project_id}/leads/{lead_id}/call-authorization", status_code=201)
def authorize_call(project_id: UUID, lead_id: UUID, db: Session = Db):
    project = project_access(db, project_id, OPERATORS)
    lead = lead_for(db, project_id, lead_id, lock=True)
    if lead.status in ("sold", "declined"):
        raise HTTPException(409, "Leadet er avsluttet")
    decision, evidence = eligibility(db, project, lead)
    if not decision.allowed:
        raise HTTPException(409, decision.reason)
    lead.reserved_by, lead.reserved_until = db.info["user_id"], now() + timedelta(minutes=15)
    call = Call(project_id=project.id, partner_id=project.partner_id, lead_id=lead.id,
                user_id=db.info["user_id"], authorization=evidence)
    db.add(call)
    db.flush()
    audit(db, project, "call.authorized", call.id, evidence)
    return {"id": call.id, "phone": lead.phone, "expires_at": lead.reserved_until}


@router.patch("/projects/{project_id}/calls/{call_id}")
def complete_call(project_id: UUID, call_id: UUID, body: CallResult, db: Session = Db):
    project = project_access(db, project_id, OPERATORS)
    call = db.scalar(select(Call).where(Call.id == call_id, Call.project_id == project_id).with_for_update())
    if not call or call.user_id != db.info["user_id"]:
        raise HTTPException(404, "Samtalen finnes ikke")
    if call.completed_at:
        raise HTTPException(409, "Utfallet er allerede registrert")
    if body.outcome == "callback" and (body.callback_at is None or body.callback_at <= now()):
        raise HTTPException(422, "Velg et fremtidig tidspunkt for tilbakekalling")
    lead = lead_for(db, project_id, call.lead_id, lock=True)
    if lead.reserved_by != db.info["user_id"] or not lead.reserved_until or lead.reserved_until <= now():
        raise HTTPException(409, "Reservasjonen er utløpt. Reserver leadet på nytt før utfallet lagres.")
    call.outcome, call.note, call.completed_at = body.outcome, body.note, now()
    # A call outcome never substitutes for an actual sale or meeting record.
    if body.outcome in ("declined", "callback") and lead.status not in ("sold", "meeting"):
        lead.status = body.outcome
    if body.outcome == "callback":
        lead.callback_at = body.callback_at
    if lead.reserved_by == db.info["user_id"]:
        lead.reserved_by = lead.reserved_until = None
    audit(db, project, "call.completed", call.id, {"outcome": body.outcome})
    return {"id": call.id, "outcome": call.outcome}


@router.get("/projects/{project_id}/products")
def products(project_id: UUID, db: Session = Db):
    project_access(db, project_id)
    return [{"id": p.id, "name": p.name, "price_ore": p.price_ore} for p in db.scalars(select(Product).where(Product.project_id == project_id))]


@router.get("/projects/{project_id}/sales")
def sales(project_id: UUID, db: Session = Db):
    project_access(db, project_id)
    return [{"id": s.id, "lead_id": s.lead_id, "amount_ore": s.amount_ore, "status": s.status,
             "allocation": s.allocation, "created_at": s.created_at} for s in db.scalars(select(Sale).where(Sale.project_id == project_id).order_by(Sale.created_at.desc()).limit(500))]


@router.post("/projects/{project_id}/sales", status_code=201)
def register_sale(project_id: UUID, body: SaleCreate, db: Session = Db):
    project = project_access(db, project_id, {"seller", "closer", "leader", "admin"})
    if not project.active:
        raise HTTPException(409, "Prosjektet er pauset")
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"{project_id}:{body.idempotency_key}"})
    existing = db.scalar(select(Sale).where(Sale.project_id == project_id, Sale.idempotency_key == body.idempotency_key))
    if existing:
        if (existing.lead_id, existing.product_id, existing.seller_id) != (body.lead_id, body.product_id, db.info["user_id"]):
            raise HTTPException(409, "Nøkkelen er brukt til et annet salg")
        return {"id": existing.id, "status": existing.status, "allocation": existing.allocation}
    lead = lead_for(db, project_id, body.lead_id, lock=True)
    if lead.status == "sold":
        raise HTTPException(409, "Leadet har allerede et registrert salg")
    if lead.reserved_by != db.info["user_id"] or not lead.reserved_until or lead.reserved_until <= now():
        raise HTTPException(409, "Reserver leadet før salg registreres")
    product = db.scalar(select(Product).where(Product.id == body.product_id, Product.project_id == project_id))
    if not product:
        raise HTTPException(404, "Produktet finnes ikke i prosjektet")
    allocation = allocate(product.price_ore, product.hub_bps, product.seller_bps)
    sale = Sale(project_id=project.id, partner_id=project.partner_id, lead_id=lead.id,
                product_id=product.id, seller_id=db.info["user_id"], amount_ore=product.price_ore,
                status="awaiting_confirmation" if lead.kind == "b2c" else "registered",
                allocation=allocation, rule_snapshot={"version": product.rule_version, "hub_bps": product.hub_bps, "seller_bps": product.seller_bps},
                idempotency_key=body.idempotency_key)
    db.add(sale)
    lead.status, lead.reserved_by, lead.reserved_until = "sold", None, None
    db.flush()
    audit(db, project, "sale.registered", sale.id)
    return {"id": sale.id, "status": sale.status, "allocation": allocation}


@router.post("/projects/{project_id}/sales/{sale_id}/approve")
def approve_sale(project_id: UUID, sale_id: UUID, db: Session = Db):
    project = project_access(db, project_id, MANAGERS)
    sale = db.scalar(select(Sale).where(Sale.id == sale_id, Sale.project_id == project_id).with_for_update())
    if not sale:
        raise HTTPException(404, "Salget finnes ikke")
    if sale.status not in ("registered", "awaiting_confirmation"):
        raise HTTPException(409, "Salget kan ikke godkjennes i denne statusen")
    lead = lead_for(db, project_id, sale.lead_id)
    if not can_approve(lead.kind, sale.confirmed_at):
        raise HTTPException(409, "Kunden må bekrefte skriftlig før godkjenning")
    if sale.seller_id == db.info["user_id"]:
        raise HTTPException(403, "Eget salg må godkjennes av en annen leder")
    sale.status, sale.approved_by = "approved", db.info["user_id"]
    audit(db, project, "sale.approved", sale.id)
    return {"id": sale.id, "status": sale.status}


@router.get("/projects/{project_id}/meetings")
def meetings(project_id: UUID, db: Session = Db):
    project_access(db, project_id)
    return [{"id": m.id, "lead_id": m.lead_id, "starts_at": m.starts_at, "ends_at": m.ends_at,
             "closer_id": m.closer_id, "outcome": m.outcome, "qualification": m.qualification}
            for m in db.scalars(select(Meeting).where(Meeting.project_id == project_id).order_by(Meeting.starts_at).limit(500))]


@router.get("/projects/{project_id}/team")
def team(project_id: UUID, db: Session = Db):
    project_access(db, project_id, MANAGERS)
    return [{"id": m.user_id, "role": m.role} for m in db.scalars(select(Membership).where(Membership.project_id == project_id, Membership.active))]


@router.get("/projects/{project_id}/closers")
def closers(project_id: UUID, db: Session = Db):
    project_access(db, project_id, OPERATORS)
    return [dict(row) for row in db.execute(text("SELECT * FROM hub_private.project_closers(:project)"), {"project": project_id}).mappings()]


@router.post("/projects/{project_id}/meetings", status_code=201)
def book_meeting(project_id: UUID, body: MeetingCreate, db: Session = Db):
    project = project_access(db, project_id, OPERATORS)
    lead = lead_for(db, project_id, body.lead_id, lock=True)
    closer_role = db.scalar(text("SELECT hub_private.closer_allowed(:project, :closer)"), {"project": project_id, "closer": body.closer_id})
    if not closer_role:
        raise HTTPException(422, "Closeren er ikke tildelt prosjektet")
    if body.starts_at <= now() or body.ends_at <= body.starts_at or body.ends_at - body.starts_at > timedelta(hours=8):
        raise HTTPException(422, "Velg et gyldig fremtidig møtetidspunkt")
    if not project.active or lead.status in ("sold", "declined"):
        raise HTTPException(409, "Leadet er ikke tilgjengelig for booking")
    if lead.reserved_by != db.info["user_id"] or not lead.reserved_until or lead.reserved_until <= now():
        raise HTTPException(409, "Reserver leadet før booking")
    meeting = Meeting(project_id=project.id, partner_id=project.partner_id, booker_id=db.info["user_id"], **body.model_dump())
    db.add(meeting)
    db.flush()
    lead.status, lead.reserved_by, lead.reserved_until = "meeting", None, None
    audit(db, project, "meeting.booked", meeting.id)
    return {"id": meeting.id}


@router.post("/projects/{project_id}/assignments/move")
def move_assignment(project_id: UUID, body: MoveAssignment, db: Session = Db):
    source = project_access(db, project_id, MANAGERS)
    target = project_access(db, body.target_project_id, MANAGERS)
    if source.id == target.id or not target.active:
        raise HTTPException(422, "Velg et annet aktivt prosjekt")
    if source.move_rule != "release":
        raise HTTPException(409, "Flytting med leads krever avklart eierskap og samtykke; bruk frigjøring")
    # Serialize moves of the same seller, including different source projects.
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": str(body.user_id)})
    member = db.get(Membership, (project_id, body.user_id))
    if not member or not member.active or member.role not in {"seller", "booker", "closer"}:
        raise HTTPException(422, "Velg en aktiv selger, booker eller closer")
    destination = db.get(Membership, (target.id, body.user_id))
    if destination and destination.active:
        raise HTTPException(409, "Brukeren er allerede tildelt målprosjektet")
    for lead in db.scalars(select(Lead).where(Lead.project_id == project_id, Lead.reserved_by == body.user_id).with_for_update()):
        lead.reserved_by = lead.reserved_until = None
    if destination:
        destination.active, destination.role = True, member.role
    else:
        db.add(Membership(project_id=target.id, user_id=body.user_id, role=member.role, active=True))
    member.active = False
    audit(db, source, "assignment.ended", body.user_id, {"target_project_id": str(target.id)})
    audit(db, target, "assignment.started", body.user_id, {"source_project_id": str(source.id)})
    return {"moved": True}


@router.get("/projects/{project_id}/exports/sales.csv")
def export_sales(project_id: UUID, db: Session = Db):
    project_access(db, project_id, MANAGERS)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["sale_id", "amount_ore", "currency", "status", "seller_ore", "hub_ore", "partner_ore"])
    for sale in db.scalars(select(Sale).where(Sale.project_id == project_id)):
        writer.writerow([sale.id, sale.amount_ore, sale.currency, sale.status,
                         sale.allocation["seller"], sale.allocation["hub"], sale.allocation["partner"]])
    return Response(output.getvalue(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="salg.csv"', "Cache-Control": "no-store"})
