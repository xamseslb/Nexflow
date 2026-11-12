"""Scoped company discovery, daily quota and review gate."""
from pathlib import Path
from alembic import op

revision = "0012"
down_revision = "0011"


def upgrade():
    op.execute((Path(__file__).parents[1] / "discovery_v1.sql").read_text(encoding="utf-8"))


def downgrade():
    raise RuntimeError("Use a reviewed forward migration to retain import history")
