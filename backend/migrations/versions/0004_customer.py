"""Prosjektisolert kvalitetsgjennomgang og salgsfremdrift på kundeprofilen."""
from alembic import op

revision = "0004"
down_revision = "0003"


def upgrade():
    op.execute("""
      ALTER TABLE hub.leads ADD COLUMN pipeline_step integer NOT NULL DEFAULT 1
        CHECK (pipeline_step BETWEEN 1 AND 7);

      UPDATE hub.leads l SET pipeline_step = CASE
        WHEN l.status IN ('callback','meeting') THEN 5
        WHEN EXISTS (SELECT 1 FROM hub.calls c WHERE c.lead_id = l.id
                     AND c.completed_at IS NOT NULL AND c.outcome <> 'no_answer') THEN 4
        WHEN EXISTS (SELECT 1 FROM hub.follow_ups f WHERE f.lead_id = l.id) THEN 3
        ELSE 1 END;

      CREATE FUNCTION hub_private.customer_call_step() RETURNS trigger
        LANGUAGE plpgsql SET search_path = '' AS $$
        BEGIN
          UPDATE hub.leads SET pipeline_step = greatest(pipeline_step,
            CASE WHEN NEW.outcome = 'callback' THEN 5 ELSE 4 END)
          WHERE id = NEW.lead_id AND project_id = NEW.project_id;
          RETURN NEW;
        END $$;
      CREATE TRIGGER completed_call_step AFTER UPDATE OF completed_at ON hub.calls
        FOR EACH ROW WHEN (OLD.completed_at IS NULL AND NEW.completed_at IS NOT NULL
          AND NEW.outcome <> 'no_answer') EXECUTE FUNCTION hub_private.customer_call_step();

      CREATE FUNCTION hub_private.customer_task_step() RETURNS trigger
        LANGUAGE plpgsql SET search_path = '' AS $$
        BEGIN
          UPDATE hub.leads SET pipeline_step = greatest(pipeline_step, 3)
          WHERE id = NEW.lead_id AND project_id = NEW.project_id;
          RETURN NEW;
        END $$;
      CREATE TRIGGER planned_contact_step AFTER INSERT ON hub.follow_ups
        FOR EACH ROW EXECUTE FUNCTION hub_private.customer_task_step();
      REVOKE ALL ON FUNCTION hub_private.customer_call_step(), hub_private.customer_task_step() FROM PUBLIC;

      CREATE TABLE hub.quality_flags (
        id uuid PRIMARY KEY,
        created_at timestamptz NOT NULL DEFAULT now(),
        project_id uuid NOT NULL, partner_id uuid NOT NULL, call_id uuid NOT NULL UNIQUE,
        reported_by uuid NOT NULL, reason varchar(1000) NOT NULL CHECK (length(trim(reason)) > 0),
        reviewed_by uuid, reviewed_at timestamptz, review_note varchar(1000),
        FOREIGN KEY (project_id,partner_id) REFERENCES hub.projects(id,partner_id),
        FOREIGN KEY (call_id,project_id,partner_id) REFERENCES hub.calls(id,project_id,partner_id),
        FOREIGN KEY (project_id,reported_by) REFERENCES hub.memberships(project_id,user_id),
        FOREIGN KEY (project_id,reviewed_by) REFERENCES hub.memberships(project_id,user_id),
        CHECK ((reviewed_at IS NULL AND reviewed_by IS NULL AND review_note IS NULL)
           OR (reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL AND review_note IS NOT NULL
               AND length(trim(review_note)) > 0))
      );
      CREATE INDEX quality_pending ON hub.quality_flags(project_id, created_at, id) WHERE reviewed_at IS NULL;
      ALTER TABLE hub.quality_flags ENABLE ROW LEVEL SECURITY;
      CREATE POLICY quality_read ON hub.quality_flags FOR SELECT TO hub_api USING (
        hub_private.project_role(project_id) IN ('leader','admin') OR (
          reported_by = auth.uid() AND hub_private.project_role(project_id) IN ('seller','booker','closer')
          AND EXISTS (SELECT 1 FROM hub.calls c JOIN hub.leads l ON l.id = c.lead_id
                      WHERE c.id = quality_flags.call_id AND l.project_id = quality_flags.project_id)));
      CREATE POLICY quality_report ON hub.quality_flags FOR INSERT TO hub_api WITH CHECK (
        reported_by = auth.uid() AND reviewed_at IS NULL AND EXISTS (
          SELECT 1 FROM hub.calls c JOIN hub.leads l ON l.id = c.lead_id
          WHERE c.id = quality_flags.call_id AND l.project_id = quality_flags.project_id
            AND c.completed_at IS NOT NULL AND (
              hub_private.project_role(l.project_id) IN ('leader','admin') OR
              (c.user_id = auth.uid() AND hub_private.project_role(l.project_id) IN ('seller','booker','closer')))));
      CREATE POLICY quality_review ON hub.quality_flags FOR UPDATE TO hub_api
        USING (hub_private.project_role(project_id) IN ('leader','admin') AND reviewed_at IS NULL)
        WITH CHECK (hub_private.project_role(project_id) IN ('leader','admin') AND reviewed_by = auth.uid());
      GRANT SELECT, INSERT ON hub.quality_flags TO hub_api;
      GRANT UPDATE (reviewed_by,reviewed_at,review_note) ON hub.quality_flags TO hub_api;
    """)


def downgrade():
    raise RuntimeError("Bevar kvalitetshistorikken. Bruk en gjennomgått fremovermigrering.")
