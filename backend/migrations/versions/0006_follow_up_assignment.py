"""Manager delegation of project follow-ups."""
from alembic import op

revision = "0006"
down_revision = "0005"


def upgrade():
    op.execute("""
        ALTER TABLE hub.follow_ups ADD COLUMN initial_assignee_id uuid;
        -- NULL preserves the original owner for tasks created before delegation existed.
        CREATE FUNCTION hub_private.task_assignee_allowed(target uuid, contact uuid, person uuid)
        RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
          SELECT EXISTS (
            SELECT 1 FROM hub.memberships m JOIN hub.leads l ON l.project_id=m.project_id
            LEFT JOIN hub.call_lists q ON q.id=l.call_list_id
            WHERE m.project_id=$1 AND m.user_id=$3 AND m.active AND l.id=$2
              AND (m.role IN ('leader','admin') OR
                  (m.role IN ('seller','booker','closer') AND (l.call_list_id IS NULL OR q.assignee_id=$3)))
          )
        $$;
        REVOKE ALL ON FUNCTION hub_private.task_assignee_allowed(uuid,uuid,uuid) FROM PUBLIC;
        GRANT EXECUTE ON FUNCTION hub_private.task_assignee_allowed(uuid,uuid,uuid) TO hub_api;
        DROP POLICY follow_up_create ON hub.follow_ups;
        CREATE POLICY follow_up_create ON hub.follow_ups FOR INSERT TO hub_api WITH CHECK (
          created_by = auth.uid() AND (assignee_id = auth.uid() OR
             hub_private.project_role(project_id) IN ('leader','admin'))
          AND coalesce(initial_assignee_id, created_by) = assignee_id
          AND hub_private.task_assignee_allowed(project_id, lead_id, assignee_id)
        );
        GRANT UPDATE (assignee_id) ON hub.follow_ups TO hub_api;
        CREATE FUNCTION hub_private.guard_task_reassignment() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
        BEGIN
          IF NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
            IF OLD.status <> 'open' OR hub_private.project_role(NEW.project_id) NOT IN ('leader','admin')
               OR NOT hub_private.task_assignee_allowed(NEW.project_id, NEW.lead_id, NEW.assignee_id) THEN
              RAISE EXCEPTION 'Invalid task assignment' USING ERRCODE='42501';
            END IF;
          END IF;
          RETURN NEW;
        END $$;
        CREATE TRIGGER guard_task_reassignment BEFORE UPDATE OF assignee_id ON hub.follow_ups
          FOR EACH ROW EXECUTE FUNCTION hub_private.guard_task_reassignment();
    """)


def downgrade():
    raise RuntimeError("Bruk en gjennomgått fremoverrettet migrering for historiske oppgaver.")

