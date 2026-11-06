"""Restrict role escalation and customer notes even for direct queries as hub_api."""
from alembic import op

revision = "0010"
down_revision = "0009"


def upgrade():
    op.execute("""
        CREATE POLICY call_note_reader ON hub.calls AS RESTRICTIVE FOR SELECT TO hub_api USING (
          hub_private.project_role(project_id) IN ('leader', 'admin')
          OR (hub_private.project_role(project_id) IN ('seller', 'booker', 'closer')
              AND (user_id=auth.uid() OR EXISTS (
                 SELECT 1 FROM hub.leads l JOIN hub.call_lists q ON q.id=l.call_list_id
                 WHERE l.id=calls.lead_id AND l.project_id=calls.project_id AND q.assignee_id=auth.uid()
              )))
        );
        CREATE FUNCTION hub_private.guard_membership_change() RETURNS trigger
        LANGUAGE plpgsql SET search_path='' AS $$
        BEGIN
          IF current_user <> 'hub_api' THEN RETURN NEW; END IF;
          IF TG_OP='UPDATE' AND (OLD.project_id,OLD.user_id) IS DISTINCT FROM (NEW.project_id,NEW.user_id)
             THEN RAISE EXCEPTION 'Membership identity is immutable' USING ERRCODE='42501'; END IF;
          IF NEW.user_id=auth.uid() AND (TG_OP='INSERT' OR OLD.role IS DISTINCT FROM NEW.role OR OLD.active IS DISTINCT FROM NEW.active)
             THEN RAISE EXCEPTION 'Cannot change own access' USING ERRCODE='42501'; END IF;
          IF hub_private.project_role(NEW.project_id)='leader' AND
             (NEW.role NOT IN ('seller','booker','closer') OR
              (TG_OP='UPDATE' AND OLD.active AND OLD.role NOT IN ('seller','booker','closer')))
             THEN RAISE EXCEPTION 'Only admins can grant privileged roles' USING ERRCODE='42501'; END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER guard_membership_change BEFORE INSERT OR UPDATE ON hub.memberships
          FOR EACH ROW EXECUTE FUNCTION hub_private.guard_membership_change();
    """)


def downgrade():
    raise RuntimeError("Behold tilgangskontrollene til en ny migrering er gjennomgått.")

