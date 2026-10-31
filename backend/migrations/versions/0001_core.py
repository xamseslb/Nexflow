"""Initial Hub schema and deny-by-default access control."""
from pathlib import Path
from alembic import op
from migrations.schema_v1 import Base

revision = "0001"
down_revision = None


def upgrade():
    op.execute("CREATE SCHEMA hub")
    op.execute("CREATE SCHEMA hub_private")
    op.execute("CREATE ROLE hub_api NOLOGIN NOSUPERUSER NOBYPASSRLS")
    op.execute("CREATE ROLE hub_worker NOLOGIN NOSUPERUSER NOBYPASSRLS")
    Base.metadata.create_all(op.get_bind())
    sql = Path(__file__).resolve().parents[1] / "security.sql"
    # SQL file contains PL/pgSQL bodies: send as a single non-parameterized script.
    op.execute(sql.read_text(encoding="utf-8"))


def downgrade():
    raise RuntimeError("Destructive rollback is intentionally disabled; restore a verified backup or write a reviewed forward migration")
