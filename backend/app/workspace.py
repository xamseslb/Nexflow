"""Reporting, follow-up queue and a redacted lead activity timeline."""
from datetime import date, datetime, timedelta
from typing import Literal
from uuid import UUID
from fastapi import APIRouter, HTTPException, Query
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from sqlalchemy import select, text, or_
from sqlalchemy.orm import Session
from .api import Db, MANAGERS, OPERATORS, audit, lead_for, now, project_access
from .models import AuditEvent, Call, FollowUp, Meeting, Membership, Sale
from .reporting import assemble_report, distribution_summary, report_window
from .schemas import FollowUpCreate, FollowUpUpdate

router = APIRouter(prefix="/api/v1/projects/{project_id}")


@router.get("/reports")
def report(project_id: UUID, start: date | None = None, end: date | None = None,
           timezone: str = Query(default="Europe/Oslo", max_length=100), db: Session = Db):
    project_access(db, project_id, MANAGERS)
    # Compute the default calendar day in the selected zone, including near midnight.
    try:
        today = now().astimezone(ZoneInfo(timezone)).date()
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, "Ukjent tidssone") from None
    end = end or today
    start = start or end - timedelta(days=min(29, (end - date.min).days))
    lower, upper = report_window(start, end, timezone)
    params = {"project": project_id, "start": lower, "end": upper, "zone": timezone}
    # Aggregate in PostgreSQL; never derive totals from a paginated lead/sales list.
    rows = []
    for table, timestamp, metric in [("leads", "created_at", "leads"), ("calls", "completed_at", "calls"), ("meetings", "created_at", "meetings"), ("sales", "created_at", "sales")]:
        extra = ", sum(amount_ore) AS revenue_ore" if table == "sales" else ""
        condition = " AND currency = 'NOK'" if table == "sales" else ""
        rows.extend(dict(row) for row in db.execute(text(f"""
            SELECT ({timestamp} AT TIME ZONE :zone)::date AS day, count(*) AS {metric}{extra}
            FROM hub.{table} WHERE project_id = :project AND {timestamp} >= :start AND {timestamp} < :end{condition}
            GROUP BY 1 ORDER BY 1
        """), params).mappings())
    pipeline = [dict(row) for row in db.execute(text("""
        SELECT status AS stage, count(*) AS count FROM hub.leads WHERE project_id = :project GROUP BY status
    """), params).mappings()]
    cohort = dict(db.execute(text("""
        SELECT count(*) AS leads, count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM hub.sales s WHERE s.project_id = l.project_id AND s.lead_id = l.id
          AND s.created_at < :end AND s.currency = 'NOK')) AS sold
        FROM hub.leads l WHERE l.project_id = :project AND l.created_at >= :start AND l.created_at < :end
    """), params).mappings().one())
    distributions = {}
    for key, expression, join, unit in [
        ("sale_amount", "s.amount_ore::double precision", "", "ore"),
        ("hours_to_sale", "extract(epoch FROM (s.created_at - l.created_at)) / 3600.0",
         "JOIN hub.leads l ON l.id = s.lead_id AND l.project_id = s.project_id AND l.partner_id = s.partner_id", "hours"),
    ]:
        nonnegative = " AND s.created_at >= l.created_at" if join else ""
        stats = db.execute(text(f"""
            SELECT count(*) AS count,
              percentile_cont(ARRAY[0.0,0.25,0.5,0.75,1.0]) WITHIN GROUP (ORDER BY {expression}) AS quantiles
            FROM hub.sales s {join} WHERE s.project_id = :project AND s.created_at >= :start AND s.created_at < :end
              AND s.currency = 'NOK'{nonnegative}
        """), params).mappings().one()
        distributions[key] = distribution_summary(stats["count"], stats["quantiles"], unit)
    return assemble_report(start, end, timezone, rows, pipeline, cohort, distributions)


def task_payload(task: FollowUp, current: datetime):
    return {key: getattr(task, key) for key in ("id", "lead_id", "title", "note", "due_at", "status", "assignee_id", "created_at", "completed_at")} | {
        "overdue": task.status == "open" and task.due_at < current}


@router.get("/follow-ups")
def follow_ups(project_id: UUID, status: Literal["open", "done", "cancelled", "all"] = "open",
               lead_id: UUID | None = None, overdue: bool = False,
               limit: int = Query(default=50, ge=1, le=100), offset: int = Query(default=0, ge=0, le=10000), db: Session = Db):
    project_access(db, project_id, OPERATORS)
    query = select(FollowUp).where(FollowUp.project_id == project_id)
    if db.get(Membership, (project_id, db.info["user_id"])).role not in MANAGERS:
        query = query.where(FollowUp.assignee_id == db.info["user_id"])
    if lead_id:
        lead_for(db, project_id, lead_id)
        query = query.where(FollowUp.lead_id == lead_id)
    if status != "all":
        query = query.where(FollowUp.status == status)
    current = now()
    if overdue:
        query = query.where(FollowUp.status == "open", FollowUp.due_at < current)
    # RLS limits operators to their own tasks; managers see the project queue.
    tasks = list(db.scalars(query.order_by(FollowUp.due_at, FollowUp.id).offset(offset).limit(limit + 1)))
    return {"items": [task_payload(task, current) for task in tasks[:limit]], "has_more": len(tasks) > limit and offset + limit <= 10000, "truncated": len(tasks) > limit and offset + limit > 10000, "offset": offset}


@router.post("/follow-ups", status_code=201)
def create_follow_up(project_id: UUID, body: FollowUpCreate, db: Session = Db):
    project = project_access(db, project_id, OPERATORS)
    # Serializes duplicate delivery; the uniqueness constraint is a second guard.
    db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
               {"key": f"follow-up:{project_id}:{db.info['user_id']}:{body.idempotency_key}"})
    existing = db.scalar(select(FollowUp).where(FollowUp.project_id == project_id,
        FollowUp.created_by == db.info["user_id"], FollowUp.idempotency_key == body.idempotency_key))
    if existing:
        if (existing.lead_id, existing.title, existing.note, existing.due_at) != (body.lead_id, body.title, body.note, body.due_at):
            raise HTTPException(409, "Nøkkelen er allerede brukt til en annen oppgave")
        return task_payload(existing, now())
    lead = lead_for(db, project_id, body.lead_id)
    if not project.active or lead.status in ("sold", "declined"):
        raise HTTPException(409, "Velg et åpent lead i et aktivt prosjekt")
    if body.due_at <= now():
        raise HTTPException(422, "Velg et fremtidig tidspunkt for oppfølging")
    task = FollowUp(project_id=project.id, partner_id=project.partner_id, assignee_id=db.info["user_id"],
                    created_by=db.info["user_id"], status="open", **body.model_dump())
    db.add(task)
    db.flush()
    audit(db, project, "follow_up.created", task.id)
    return task_payload(task, now())


@router.patch("/follow-ups/{task_id}")
def update_follow_up(project_id: UUID, task_id: UUID, body: FollowUpUpdate, db: Session = Db):
    project = project_access(db, project_id, OPERATORS)
    task = db.scalar(select(FollowUp).where(FollowUp.project_id == project_id, FollowUp.id == task_id).with_for_update())
    if not task:
        raise HTTPException(404, "Oppgaven finnes ikke")
    member = db.info["user_id"]
    # Explicit API authorization as well as RLS.
    role = db.get(Membership, (project_id, member)).role
    if task.assignee_id != member and role not in MANAGERS:
        raise HTTPException(403, "Du kan bare endre egne oppgaver")
    if task.status == body.status:
        return task_payload(task, now())
    if task.status != "open":
        raise HTTPException(409, "Oppgaven er allerede avsluttet")
    task.status, task.completed_at = body.status, now()
    audit(db, project, f"follow_up.{body.status}", task.id)
    return task_payload(task, now())


@router.get("/leads/{lead_id}/activity")
def lead_activity(project_id: UUID, lead_id: UUID, limit: int = Query(default=30, ge=1, le=100),
                  offset: int = Query(default=0, ge=0, le=10000), db: Session = Db):
    project_access(db, project_id, OPERATORS)
    lead_for(db, project_id, lead_id)
    related = []
    for model in (Call, Meeting, Sale, FollowUp):
        related.append(AuditEvent.entity_id.in_(select(model.id).where(model.project_id == project_id, model.lead_id == lead_id)))
    events = list(db.scalars(select(AuditEvent).where(AuditEvent.project_id == project_id,
        or_(AuditEvent.entity_id == lead_id, *related)).order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc())
        .offset(offset).limit(limit + 1)))
    # No financial allocations, notes, authentication claims or raw audit details.
    return {"items": [{"id": event.id, "action": event.action, "created_at": event.created_at} for event in events[:limit]],
            "has_more": len(events) > limit and offset + limit <= 10000, "truncated": len(events) > limit and offset + limit > 10000, "offset": offset}
