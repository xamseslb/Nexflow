from datetime import datetime
from uuid import UUID, uuid4
from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKeyConstraint, Integer, String, Text, UniqueConstraint, CheckConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Record:
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Partner(Record, Base):
    __tablename__ = "partners"
    __table_args__ = {"schema": "hub"}
    name: Mapped[str] = mapped_column(String(200))
    org_number: Mapped[str | None] = mapped_column(String(9))
    agreement_signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Project(Record, Base):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("id", "partner_id"), ForeignKeyConstraint(["partner_id"], ["hub.partners.id"]), {"schema": "hub"})
    partner_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    kind: Mapped[str] = mapped_column(String(10), default="b2b")
    project_type: Mapped[str] = mapped_column(String(80), server_default="")
    move_rule: Mapped[str] = mapped_column(String(20), default="release")


class Membership(Base):
    __tablename__ = "memberships"
    __table_args__ = (ForeignKeyConstraint(["project_id"], ["hub.projects.id"]), CheckConstraint("role IN ('seller','booker','closer','leader','partner','admin')"), {"schema": "hub"})
    project_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    role: Mapped[str] = mapped_column(String(20))
    team_name: Mapped[str] = mapped_column(String(80), default="")
    strengths: Mapped[str] = mapped_column(String(300), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Scoped:
    partner_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), index=True)
    project_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), index=True)


def scope_constraints(*extra):
    return (UniqueConstraint("id", "project_id", "partner_id"),
            ForeignKeyConstraint(["project_id", "partner_id"], ["hub.projects.id", "hub.projects.partner_id"]),
            *extra, {"schema": "hub"})


class CallList(Record, Scoped, Base):
    __tablename__ = "call_lists"
    __table_args__ = scope_constraints(
        CheckConstraint("category IN ('hot','cold','winback')"),
        UniqueConstraint("project_id", "name"),
        ForeignKeyConstraint(["project_id", "assignee_id"], ["hub.memberships.project_id", "hub.memberships.user_id"]),
    )
    name: Mapped[str] = mapped_column(String(100))
    category: Mapped[str] = mapped_column(String(10))
    assignee_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))


class Lead(Record, Scoped, Base):
    __tablename__ = "leads"
    __table_args__ = scope_constraints(CheckConstraint("kind IN ('b2b','b2c')"), CheckConstraint("status IN ('new','callback','meeting','sold','declined')"),
        ForeignKeyConstraint(["call_list_id", "project_id", "partner_id"], ["hub.call_lists.id", "hub.call_lists.project_id", "hub.call_lists.partner_id"]))
    call_list_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    queue_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    company: Mapped[str] = mapped_column(String(200))
    contact: Mapped[str] = mapped_column(String(200), default="")
    phone: Mapped[str] = mapped_column(String(30))
    org_number: Mapped[str | None] = mapped_column(String(9))
    kind: Mapped[str] = mapped_column(String(10), default="b2b")
    status: Mapped[str] = mapped_column(String(20), default="new")
    priority: Mapped[int] = mapped_column(Integer, default=0)
    industry: Mapped[str] = mapped_column(String(120), default="")
    city: Mapped[str] = mapped_column(String(100), default="")
    source: Mapped[str] = mapped_column(String(200), default="manual")
    summary: Mapped[str] = mapped_column(Text, default="")
    # Steps 1–7 are manually adjustable. The final stage comes from a registered sale.
    pipeline_step: Mapped[int] = mapped_column(Integer, server_default="1")
    enrichment: Mapped[dict] = mapped_column(JSONB, default=dict)
    blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    review_required: Mapped[bool] = mapped_column(Boolean, server_default="false")
    reserved_by: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    reserved_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    callback_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


def lead_fk():
    return ForeignKeyConstraint(["lead_id", "project_id", "partner_id"], ["hub.leads.id", "hub.leads.project_id", "hub.leads.partner_id"])


class RegistryCheck(Record, Scoped, Base):
    __tablename__ = "registry_checks"
    __table_args__ = scope_constraints(lead_fk())
    lead_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    phone: Mapped[str] = mapped_column(String(30))
    reserved: Mapped[bool] = mapped_column(Boolean)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    source: Mapped[str] = mapped_column(String(200))


class Consent(Record, Scoped, Base):
    __tablename__ = "consents"
    __table_args__ = scope_constraints(lead_fk())
    lead_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    phone: Mapped[str] = mapped_column(String(30))
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    evidence: Mapped[str] = mapped_column(Text)


class Call(Record, Scoped, Base):
    __tablename__ = "calls"
    __table_args__ = scope_constraints(lead_fk())
    lead_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    outcome: Mapped[str | None] = mapped_column(String(20))
    note: Mapped[str] = mapped_column(Text, default="")
    authorization: Mapped[dict] = mapped_column(JSONB)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    callback_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class QualityFlag(Record, Scoped, Base):
    __tablename__ = "quality_flags"
    __table_args__ = scope_constraints(
        ForeignKeyConstraint(["call_id", "project_id", "partner_id"],
                             ["hub.calls.id", "hub.calls.project_id", "hub.calls.partner_id"]),
        UniqueConstraint("call_id"),
        ForeignKeyConstraint(["project_id", "reported_by"], ["hub.memberships.project_id", "hub.memberships.user_id"]),
        ForeignKeyConstraint(["project_id", "reviewed_by"], ["hub.memberships.project_id", "hub.memberships.user_id"]),
    )
    call_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    reported_by: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    reason: Mapped[str] = mapped_column(String(1000))
    reviewed_by: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_note: Mapped[str | None] = mapped_column(String(1000))


class Product(Record, Scoped, Base):
    __tablename__ = "products"
    __table_args__ = scope_constraints(CheckConstraint("price_ore > 0"), CheckConstraint("hub_bps >= 0 AND seller_bps >= 0 AND hub_bps + seller_bps <= 10000"))
    name: Mapped[str] = mapped_column(String(200))
    price_ore: Mapped[int] = mapped_column(BigInteger)
    hub_bps: Mapped[int] = mapped_column(Integer)
    seller_bps: Mapped[int] = mapped_column(Integer)
    rule_version: Mapped[int] = mapped_column(Integer, default=1)


class Sale(Record, Scoped, Base):
    __tablename__ = "sales"
    __table_args__ = scope_constraints(lead_fk(), ForeignKeyConstraint(["product_id", "project_id", "partner_id"], ["hub.products.id", "hub.products.project_id", "hub.products.partner_id"]), UniqueConstraint("project_id", "idempotency_key"), CheckConstraint("amount_ore > 0"))
    lead_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    product_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    seller_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    amount_ore: Mapped[int] = mapped_column(BigInteger)
    team_at_sale: Mapped[str | None] = mapped_column(String(80))
    currency: Mapped[str] = mapped_column(String(3), default="NOK")
    status: Mapped[str] = mapped_column(String(30), default="registered")
    allocation: Mapped[dict] = mapped_column(JSONB)
    rule_snapshot: Mapped[dict] = mapped_column(JSONB)
    idempotency_key: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    withdrawal_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_by: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))


class Meeting(Record, Scoped, Base):
    __tablename__ = "meetings"
    __table_args__ = scope_constraints(lead_fk(), CheckConstraint("ends_at > starts_at"))
    lead_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    booker_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    closer_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    outcome: Mapped[str] = mapped_column(String(30), default="booked")
    qualification: Mapped[dict] = mapped_column(JSONB)


class AuditEvent(Record, Scoped, Base):
    __tablename__ = "audit_events"
    __table_args__ = scope_constraints()
    actor_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    action: Mapped[str] = mapped_column(String(100))
    entity_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    details: Mapped[dict] = mapped_column(JSONB, default=dict)


class Job(Record, Scoped, Base):
    __tablename__ = "jobs"
    __table_args__ = scope_constraints()
    kind: Mapped[str] = mapped_column(String(80))
    payload: Mapped[dict] = mapped_column(JSONB)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_error: Mapped[str | None] = mapped_column(Text)


class FollowUp(Record, Scoped, Base):
    __tablename__ = "follow_ups"
    __table_args__ = scope_constraints(
        lead_fk(),
        ForeignKeyConstraint(["project_id", "assignee_id"], ["hub.memberships.project_id", "hub.memberships.user_id"]),
        CheckConstraint("status IN ('open','done','cancelled')"),
        CheckConstraint("length(trim(title)) > 0"),
        CheckConstraint("(status = 'open' AND completed_at IS NULL) OR (status <> 'open' AND completed_at IS NOT NULL)"),
        UniqueConstraint("project_id", "created_by", "idempotency_key"),
    )
    lead_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    assignee_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    initial_assignee_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    created_by: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))
    title: Mapped[str] = mapped_column(String(200))
    note: Mapped[str] = mapped_column(Text, default="")
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    status: Mapped[str] = mapped_column(String(20), default="open")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    idempotency_key: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True))


class DiscoverySettings(Record, Scoped, Base):
    __tablename__ = "discovery_settings"
    __table_args__ = scope_constraints(UniqueConstraint("project_id"),
        ForeignKeyConstraint(["call_list_id", "project_id", "partner_id"],
                             ["hub.call_lists.id", "hub.call_lists.project_id", "hub.call_lists.partner_id"]))
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    municipality: Mapped[str] = mapped_column(String(4), server_default="0301")
    daily_limit: Mapped[int] = mapped_column(Integer, server_default="20")
    industries: Mapped[list] = mapped_column(JSONB, default=list)
    call_list_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    page: Mapped[int] = mapped_column(Integer, server_default="0")
    offset: Mapped[int] = mapped_column(Integer, server_default="0")
    next_run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_summary: Mapped[dict] = mapped_column(JSONB, default=dict)
    last_error: Mapped[str | None] = mapped_column(Text)


class DiscoveryRecord(Record, Scoped, Base):
    __tablename__ = "discovery_records"
    __table_args__ = scope_constraints(UniqueConstraint("project_id", "org_number"), lead_fk())
    org_number: Mapped[str] = mapped_column(String(9))
    company: Mapped[str] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(30))
    reason: Mapped[str] = mapped_column(String(200))
    lead_id: Mapped[UUID | None] = mapped_column(PGUUID(as_uuid=True))
    source_url: Mapped[str] = mapped_column(Text)
