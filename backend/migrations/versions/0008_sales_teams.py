"""Keep project team and seller strengths; capture the team at the time of sale."""
from alembic import op

revision = "0008"
down_revision = "0007"


def upgrade():
    op.execute("""
        ALTER TABLE hub.memberships ADD COLUMN team_name varchar(80) NOT NULL DEFAULT '',
                                    ADD COLUMN strengths varchar(300) NOT NULL DEFAULT '';
        ALTER TABLE hub.sales ADD COLUMN team_at_sale varchar(80);
        CREATE FUNCTION hub_private.record_sale_team() RETURNS trigger
        LANGUAGE plpgsql SET search_path = '' AS $$
        BEGIN
          SELECT nullif(m.team_name, '') INTO NEW.team_at_sale FROM hub.memberships m
          WHERE m.project_id = NEW.project_id AND m.user_id = NEW.seller_id AND m.active;
          RETURN NEW;
        END $$;
        CREATE TRIGGER record_sale_team BEFORE INSERT ON hub.sales
        FOR EACH ROW EXECUTE FUNCTION hub_private.record_sale_team();
        CREATE INDEX sale_team_history ON hub.sales(project_id,team_at_sale,created_at);
    """)


def downgrade():
    raise RuntimeError("Behold historisk teamtilhørighet på registrerte salg.")

