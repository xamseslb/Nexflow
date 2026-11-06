"""Independent project-type label for sales operations and portfolio filtering."""
from alembic import op

revision = "0009"
down_revision = "0008"


def upgrade():
    op.execute("""
      ALTER TABLE hub.projects ADD COLUMN project_type varchar(80) NOT NULL DEFAULT '';
      CREATE POLICY project_type_update ON hub.projects FOR UPDATE TO hub_api
        USING (hub_private.project_role(id) IN ('leader','admin'))
        WITH CHECK (hub_private.project_role(id) IN ('leader','admin'));
      GRANT UPDATE(project_type) ON hub.projects TO hub_api;
    """)


def downgrade():
    raise RuntimeError("Bevar prosjekttypene med en gjennomgått fremovermigrering.")
