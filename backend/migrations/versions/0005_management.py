"""Scoped team names and private sale documentation on Supabase Storage."""
from pathlib import Path
from alembic import op

revision = "0005"
down_revision = "0004"


def upgrade():
    op.execute("""
        CREATE FUNCTION hub_private.team_directory(target uuid)
        RETURNS TABLE(id uuid, name text, role text, active boolean)
        LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
          SELECT m.user_id, COALESCE(NULLIF(u.raw_user_meta_data->>'display_name',''),
                 NULLIF(u.raw_user_meta_data->>'full_name',''), 'Bruker ' || left(m.user_id::text, 8)),
                 m.role::text, m.active
          FROM hub.memberships m JOIN auth.users u ON u.id=m.user_id
          WHERE m.project_id=target AND hub_private.project_role(target) IN ('admin','leader')
        $$;
        REVOKE ALL ON FUNCTION hub_private.team_directory(uuid) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION hub_private.team_directory(uuid) TO hub_api;
    """)
    op.execute((Path(__file__).resolve().parents[1] / "sale_documents.sql").read_text(encoding="utf-8"))


def downgrade():
    raise RuntimeError("Bruk en gjennomgått fremoverrettet migrering for salgsdokumenter.")

