"""Register product sales, freeze commission rules, approve and export sales."""

import csv
import io
from uuid import UUID

from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .domain import allocate, can_approve
from .models import Membership, Product, Sale
from .project_access import MANAGERS, Db, audit, lead_for, now, project_access
from .schemas import SaleCreate

router = APIRouter(prefix="/api/v1")


@router.get("/projects/{project_id}/products")
def products(project_id: UUID, db: Session = Db):
    project_access(db, project_id)
    return [
        {"id": p.id, "name": p.name, "price_ore": p.price_ore}
        for p in db.scalars(select(Product).where(Product.project_id == project_id))
    ]


@router.get("/projects/{project_id}/sales")
def sales(project_id: UUID, db: Session = Db):
    project_access(db, project_id)
    uid = db.info["user_id"]
    role = db.get(Membership, (project_id, uid)).role
    return [
        {
            "can_manage_documents": role in MANAGERS
            or (role in {"seller", "closer"} and s.seller_id == uid),
            "id": s.id,
            "lead_id": s.lead_id,
            "amount_ore": s.amount_ore,
            "status": s.status,
            "allocation": s.allocation,
            "created_at": s.created_at,
        }
        for s in db.scalars(
            select(Sale)
            .where(Sale.project_id == project_id)
            .order_by(Sale.created_at.desc())
            .limit(500)
        )
    ]


@router.post("/projects/{project_id}/sales", status_code=201)
def register_sale(project_id: UUID, body: SaleCreate, db: Session = Db):
    project = project_access(db, project_id, {"seller", "closer", "leader", "admin"})
    if not project.active:
        raise HTTPException(409, "Prosjektet er pauset")
    # Two retries with the same key must see the same sale, even before its row exists.
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
        {"key": f"{project_id}:{body.idempotency_key}"},
    )
    existing = db.scalar(
        select(Sale).where(
            Sale.project_id == project_id, Sale.idempotency_key == body.idempotency_key
        )
    )
    if existing:
        if (existing.lead_id, existing.product_id, existing.seller_id) != (
            body.lead_id,
            body.product_id,
            db.info["user_id"],
        ):
            raise HTTPException(409, "Nøkkelen er brukt til et annet salg")
        return {"id": existing.id, "status": existing.status, "allocation": existing.allocation}
    lead = lead_for(db, project_id, body.lead_id, lock=True)
    if lead.status == "sold":
        raise HTTPException(409, "Leadet har allerede et registrert salg")
    if (
        lead.reserved_by != db.info["user_id"]
        or not lead.reserved_until
        or lead.reserved_until <= now()
    ):
        raise HTTPException(409, "Reserver leadet før salg registreres")
    product = db.scalar(
        select(Product).where(Product.id == body.product_id, Product.project_id == project_id)
    )
    if not product:
        raise HTTPException(404, "Produktet finnes ikke i prosjektet")
    # Store both the amounts and the rule used so later price changes cannot alter history.
    allocation = allocate(product.price_ore, product.hub_bps, product.seller_bps)
    sale = Sale(
        project_id=project.id,
        partner_id=project.partner_id,
        lead_id=lead.id,
        product_id=product.id,
        seller_id=db.info["user_id"],
        amount_ore=product.price_ore,
        status="awaiting_confirmation" if lead.kind == "b2c" else "registered",
        allocation=allocation,
        rule_snapshot={
            "version": product.rule_version,
            "hub_bps": product.hub_bps,
            "seller_bps": product.seller_bps,
        },
        idempotency_key=body.idempotency_key,
    )
    db.add(sale)
    lead.status, lead.reserved_by, lead.reserved_until = "sold", None, None
    db.flush()
    audit(db, project, "sale.registered", sale.id)
    return {"id": sale.id, "status": sale.status, "allocation": allocation}


@router.post("/projects/{project_id}/sales/{sale_id}/approve")
def approve_sale(project_id: UUID, sale_id: UUID, db: Session = Db):
    project = project_access(db, project_id, MANAGERS)
    sale = db.scalar(
        select(Sale).where(Sale.id == sale_id, Sale.project_id == project_id).with_for_update()
    )
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


@router.get("/projects/{project_id}/exports/sales.csv")
def export_sales(project_id: UUID, db: Session = Db):
    project_access(db, project_id, MANAGERS)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        ["sale_id", "amount_ore", "currency", "status", "seller_ore", "hub_ore", "partner_ore"]
    )
    for sale in db.scalars(select(Sale).where(Sale.project_id == project_id)):
        writer.writerow(
            [
                sale.id,
                sale.amount_ore,
                sale.currency,
                sale.status,
                sale.allocation["seller"],
                sale.allocation["hub"],
                sale.allocation["partner"],
            ]
        )
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={
            "Content-Disposition": 'attachment; filename="salg.csv"',
            "Cache-Control": "no-store",
        },
    )
