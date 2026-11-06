"""Named calling queues with project and salesperson isolation."""
from alembic import op

revision = "0003"
down_revision = "0002"


def upgrade():
    op.execute("""
        CREATE TABLE hub.call_lists (
            id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
            project_id uuid NOT NULL, partner_id uuid NOT NULL,
            name varchar(100) NOT NULL CHECK (length(trim(name)) > 0),
            category varchar(10) NOT NULL CHECK (category IN ('hot','cold','winback')),
            assignee_id uuid,
            UNIQUE (id, project_id, partner_id), UNIQUE (project_id, name),
            FOREIGN KEY (project_id, partner_id) REFERENCES hub.projects (id, partner_id),
            FOREIGN KEY (project_id, assignee_id) REFERENCES hub.memberships (project_id, user_id)
        );
        ALTER TABLE hub.leads ADD COLUMN call_list_id uuid, ADD COLUMN queue_completed_at timestamptz,
            ADD FOREIGN KEY (call_list_id, project_id, partner_id) REFERENCES hub.call_lists(id, project_id, partner_id);
        ALTER TABLE hub.calls ADD COLUMN callback_at timestamptz;
        CREATE INDEX call_list_queue ON hub.leads (call_list_id, priority DESC, created_at, id)
            WHERE call_list_id IS NOT NULL AND queue_completed_at IS NULL;
        CREATE INDEX call_list_assignment ON hub.call_lists(project_id, assignee_id);
        CREATE INDEX call_by_contact ON hub.calls (project_id, lead_id, completed_at DESC);
        ALTER TABLE hub.call_lists ENABLE ROW LEVEL SECURITY;
        CREATE POLICY list_read ON hub.call_lists FOR SELECT TO hub_api USING (
            hub_private.project_role(project_id) IN ('leader','admin')
            OR (assignee_id = auth.uid() AND hub_private.project_role(project_id) IN ('seller','booker','closer'))
        );
        CREATE POLICY list_manage ON hub.call_lists FOR ALL TO hub_api
            USING (hub_private.project_role(project_id) IN ('leader','admin'))
            WITH CHECK (hub_private.project_role(project_id) IN ('leader','admin'));
        GRANT SELECT, INSERT, UPDATE ON hub.call_lists TO hub_api;

        CREATE POLICY list_visibility ON hub.leads AS RESTRICTIVE FOR ALL TO hub_api USING (
            call_list_id IS NULL OR hub_private.project_role(project_id) IN ('leader','admin','partner')
            OR EXISTS (SELECT 1 FROM hub.call_lists q WHERE q.id = leads.call_list_id AND q.assignee_id = auth.uid())
        );
        CREATE FUNCTION hub_private.guard_list_assignment() RETURNS trigger
        LANGUAGE plpgsql SET search_path='' AS $$
        BEGIN
            IF current_user = 'hub_api' AND (TG_OP = 'INSERT' OR OLD.call_list_id IS DISTINCT FROM NEW.call_list_id)
                AND (TG_OP <> 'INSERT' OR NEW.call_list_id IS NOT NULL)
                AND hub_private.project_role(NEW.project_id) NOT IN ('leader','admin') THEN
                RAISE EXCEPTION 'List assignment requires manager' USING ERRCODE='42501';
            END IF;
            RETURN NEW;
        END $$;
        CREATE TRIGGER list_assignment BEFORE INSERT OR UPDATE OF call_list_id ON hub.leads
            FOR EACH ROW EXECUTE FUNCTION hub_private.guard_list_assignment();
    """)
    for table in ("calls", "meetings", "follow_ups", "registry_checks", "consents"):
        op.execute(f"""CREATE POLICY contact_visibility ON hub.{table} AS RESTRICTIVE FOR ALL TO hub_api
            USING (EXISTS (SELECT 1 FROM hub.leads l WHERE l.id = {table}.lead_id
               AND l.project_id = {table}.project_id))""")


def downgrade():
    raise RuntimeError("Use a reviewed forward migration to preserve list assignments and history")

