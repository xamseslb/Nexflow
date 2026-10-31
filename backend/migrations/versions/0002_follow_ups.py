"""Project-scoped follow-up tasks and report indexes."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

revision = "0002"
down_revision = "0001"


def upgrade():
    op.create_table(
        "follow_ups",
        sa.Column("id", pg.UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("project_id", pg.UUID(as_uuid=True), nullable=False),
        sa.Column("partner_id", pg.UUID(as_uuid=True), nullable=False),
        sa.Column("lead_id", pg.UUID(as_uuid=True), nullable=False),
        sa.Column("assignee_id", pg.UUID(as_uuid=True), nullable=False),
        sa.Column("created_by", pg.UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("idempotency_key", pg.UUID(as_uuid=True), nullable=False),
        sa.UniqueConstraint("id", "project_id", "partner_id"),
        sa.UniqueConstraint("project_id", "created_by", "idempotency_key"),
        sa.ForeignKeyConstraint(["project_id", "partner_id"], ["hub.projects.id", "hub.projects.partner_id"]),
        sa.ForeignKeyConstraint(["lead_id", "project_id", "partner_id"], ["hub.leads.id", "hub.leads.project_id", "hub.leads.partner_id"]),
        sa.ForeignKeyConstraint(["project_id", "assignee_id"], ["hub.memberships.project_id", "hub.memberships.user_id"]),
        sa.CheckConstraint("status IN ('open','done','cancelled')"),
        sa.CheckConstraint("length(trim(title)) > 0"),
        sa.CheckConstraint("(status = 'open' AND completed_at IS NULL) OR (status <> 'open' AND completed_at IS NOT NULL)"),
        schema="hub",
    )
    op.execute("ALTER TABLE hub.follow_ups ENABLE ROW LEVEL SECURITY")
    op.execute("""CREATE POLICY follow_up_read ON hub.follow_ups FOR SELECT TO hub_api
      USING (hub_private.project_role(project_id) IN ('leader','admin') OR
        (assignee_id = auth.uid() AND hub_private.project_role(project_id) IN ('seller','booker','closer')))""")
    op.execute("""CREATE POLICY follow_up_create ON hub.follow_ups FOR INSERT TO hub_api
      WITH CHECK (created_by = auth.uid() AND assignee_id = auth.uid() AND
        hub_private.project_role(project_id) IN ('seller','booker','closer','leader','admin'))""")
    op.execute("""CREATE POLICY follow_up_update ON hub.follow_ups FOR UPDATE TO hub_api
      USING (hub_private.project_role(project_id) IN ('leader','admin') OR
        (assignee_id = auth.uid() AND hub_private.project_role(project_id) IN ('seller','booker','closer')))
      WITH CHECK (hub_private.project_role(project_id) IN ('leader','admin') OR
        (assignee_id = auth.uid() AND hub_private.project_role(project_id) IN ('seller','booker','closer')))""")
    op.execute("GRANT SELECT, INSERT ON hub.follow_ups TO hub_api")
    op.execute("GRANT UPDATE (status, completed_at) ON hub.follow_ups TO hub_api")
    for column in ("project_id", "partner_id", "due_at"):
        op.create_index(f"ix_hub_follow_ups_{column}", "follow_ups", [column], schema="hub")
    op.create_index("follow_ups_lead", "follow_ups", ["project_id", "lead_id", "created_at"], schema="hub")
    op.create_index("follow_ups_queue", "follow_ups", ["project_id", "assignee_id", "status", "due_at", "id"], schema="hub")
    for table, column in [("leads", "created_at"), ("sales", "created_at"), ("meetings", "created_at"), ("calls", "completed_at"), ("audit_events", "created_at")]:
        op.create_index(f"{table}_report_period", table, ["project_id", column], schema="hub")


def downgrade():
    raise RuntimeError("Use a reviewed forward migration; task history must not be silently deleted")
