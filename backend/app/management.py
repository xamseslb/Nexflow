"""Project membership administration and manager-only sales drill-down."""
from typing import Literal
from uuid import UUID

from pydantic import Field
from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import and_, func, select, text, update
from sqlalchemy.orm import Session

from .api import Db, MANAGERS, audit, project_access
from .models import Call, CallList, Lead, Meeting, Membership, Product, Project, Sale
from .schemas import Input

router = APIRouter(prefix="/api/v1")


class AccessChange(Input):
    role: Literal["seller", "booker", "closer", "leader", "partner", "admin"]
    active: bool
    team_name: str = Field(default="", max_length=80)
    strengths: str = Field(default="", max_length=300)


@router.get("/projects/{project_id}/members")
def members(project_id: UUID, db: Session = Db):
    project_access(db, project_id, MANAGERS)
    return db.execute(text("""SELECT d.*, m.team_name, m.strengths FROM hub_private.team_directory(:project) d
                      JOIN hub.memberships m ON m.project_id=:project AND m.user_id=d.id ORDER BY d.name, d.id"""),
                      {"project": project_id}).mappings().all()


@router.patch("/projects/{project_id}/members/{user_id}")
def change_access(project_id: UUID, user_id: UUID, body: AccessChange, db: Session = Db):
    # Re-check the actor after concurrent changes to administrators in this project.
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:project, 0))"),
               {"project": f"project-members:{project_id}"})
    project = project_access(db, project_id, {"admin"})
    if user_id == db.info["user_id"]:
        raise HTTPException(409, "En annen administrator må endre tilgangen din.")
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:person, 0))"), {"person": str(user_id)})
    current = db.get(Membership, (project_id, user_id), with_for_update=True)
    changes = body.model_dump(exclude_unset=True)
    if current and all(getattr(current, field) == value for field, value in changes.items()):
        return {"id": user_id, "role": current.role, "active": current.active}
    if not current:
        if not body.active:
            raise HTTPException(404, "Brukeren har ingen tilgang i prosjektet.")
        current = Membership(project_id=project_id, user_id=user_id)
        db.add(current)
    if not body.active or body.role == "partner":
        db.execute(update(CallList).where(CallList.project_id == project_id,
                   CallList.assignee_id == user_id).values(assignee_id=None))
        db.execute(update(Lead).where(Lead.project_id == project_id, Lead.reserved_by == user_id)
                   .values(reserved_by=None, reserved_until=None))
    for field, value in changes.items():
        setattr(current, field, value)
    db.flush()
    audit(db, project, "membership.changed", user_id, {"fields": sorted(changes)})
    return {"id": user_id, "role": current.role, "active": current.active}


@router.get("/portfolio/sales")
def sales_portfolio(project_id: UUID | None = None, kind: Literal["b2b", "b2c", "both"] | None = None,
                    offset: int = Query(default=0, ge=0), db: Session = Db, team: str = "", project_type: str = "",
                    metric: Literal["leads", "calls", "meetings", "buyers"] | None = None):
    if project_id:
        project_access(db, project_id, MANAGERS)
    scope = [Membership.user_id == db.info["user_id"], Membership.active.is_(True),
             Membership.role.in_(MANAGERS)]
    if project_id:
        scope.append(Project.id == project_id)
    if kind:
        scope.append(Project.kind == kind)
    managed = select(Project.id, Project.project_type).join(Membership, Membership.project_id == Project.id).where(*scope)
    available_types = managed.subquery()
    project_types = list(db.scalars(select(available_types.c.project_type).where(available_types.c.project_type != "")
                                    .distinct().order_by(available_types.c.project_type)))
    if project_type:
        managed = managed.where(Project.project_type == project_type)
    permitted = select(managed.cte("managed_projects").c.id)
    filtered = Sale.project_id.in_(permitted)
    current_members = select(Membership.project_id, Membership.user_id, Membership.team_name).where(
        Membership.project_id.in_(permitted), Membership.active.is_(True), Membership.role != "partner")
    roster = current_members.subquery()
    team_names = select(roster.c.team_name).where(roster.c.team_name != "").union(
        select(Sale.team_at_sale).where(filtered, Sale.team_at_sale.is_not(None))).subquery()
    teams = list(db.scalars(select(team_names.c.team_name).order_by(team_names.c.team_name)))
    if team:
        filtered = filtered & (Sale.team_at_sale == team)

    # Activities belong to the current roster. Sale/buyer attribution is frozen at registration.
    def activity_scope(query, model, owner_column):
        query = query.where(model.project_id.in_(permitted))
        if team:
            if model is Lead:
                query = query.join(CallList, CallList.id == Lead.call_list_id)
            query = query.join(roster, and_(roster.c.project_id == model.project_id,
                               roster.c.user_id == owner_column)).where(roster.c.team_name == team)
        if model is Call:
            query = query.where(Call.completed_at.is_not(None))
        return query

    def activity_count(model, owner_column):
        return activity_scope(select(func.count()).select_from(model), model, owner_column).correlate(None).scalar_subquery()

    if metric:
        if metric == "buyers":
            query = (select(Lead.id, Lead.company, Project.name.label("project"), func.count(Sale.id).label("sales"))
                     .select_from(Sale).join(Lead, Lead.id == Sale.lead_id).join(Project, Project.id == Sale.project_id)
                     .where(filtered).group_by(Lead.id, Lead.company, Project.name).order_by(Lead.company, Lead.id))
        else:
            model, owner, detail, timestamp = {
                "leads": (Lead, CallList.assignee_id, Lead.contact, Lead.created_at),
                "calls": (Call, Call.user_id, Call.outcome, Call.completed_at),
                "meetings": (Meeting, Meeting.booker_id, Meeting.outcome, Meeting.starts_at),
            }[metric]
            query = select(model.id, Lead.company, Project.name.label("project"), detail.label("detail"),
                           timestamp.label("date")).select_from(model).join(Project, Project.id == model.project_id)
            if model is not Lead:
                query = query.join(Lead, Lead.id == model.lead_id)
            query = activity_scope(query, model, owner).order_by(timestamp.desc(), model.id)
        records = db.execute(query.offset(offset).limit(26)).mappings().all()
        return {"items": records[:25], "has_more": len(records) > 25}

    # Lead IDs are globally unique; each customer/case counts once even with multiple sales.
    count, total, buyers, leads, calls, meetings = db.execute(select(
        func.count(Sale.id), func.coalesce(func.sum(Sale.amount_ore), 0), func.count(func.distinct(Sale.lead_id)),
        activity_count(Lead, CallList.assignee_id), activity_count(Call, Call.user_id),
        activity_count(Meeting, Meeting.booker_id)).where(filtered)).one()
    per_project = db.execute(select(Sale.project_id, Project.name, func.count(Sale.id), func.sum(Sale.amount_ore))
                             .join(Project, Project.id == Sale.project_id).where(filtered)
                             .group_by(Sale.project_id, Project.name)
                             .order_by(func.sum(Sale.amount_ore).desc(), Project.name, Sale.project_id)).all()
    rows = db.execute(select(Sale, Project.name, Lead.company, Product.name)
                      .join(Project, Project.id == Sale.project_id).join(Lead, Lead.id == Sale.lead_id)
                      .join(Product, Product.id == Sale.product_id).where(filtered)
                      .order_by(Sale.created_at.desc(), Sale.id.desc()).offset(offset).limit(25)).all()
    return {"count": count, "teams": teams, "project_types": project_types, "total_ore": int(total),
            "activity": {"leads": leads, "calls": calls, "meetings": meetings, "buyers": buyers},
            "per_project": [{"project_id": pid, "project": name, "count": n, "total_ore": int(turnover)}
                            for pid, name, n, turnover in per_project],
            "items": [
        {"id": sale.id, "project_id": sale.project_id, "project": project, "company": company,
         "product": product, "team": sale.team_at_sale, "seller_id": sale.seller_id, "created_at": sale.created_at, "status": sale.status,
         "amount_ore": sale.amount_ore, "allocation": sale.allocation}
        for sale, project, company, product in rows]}

