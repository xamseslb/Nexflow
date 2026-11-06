"""Permit an assigned closer to work on the appointment without opening another seller's ring list."""
from alembic import op

revision = "0007"
down_revision = "0006"


def upgrade():
    op.execute("""
      DROP POLICY contact_visibility ON hub.meetings;
      CREATE POLICY meeting_visible ON hub.meetings AS RESTRICTIVE FOR SELECT TO hub_api USING (
        EXISTS (SELECT 1 FROM hub.leads l WHERE l.id = meetings.lead_id AND l.project_id = meetings.project_id)
        OR (closer_id = auth.uid() AND hub_private.project_role(project_id) IN ('closer','leader','admin')));
      CREATE POLICY meeting_bookable ON hub.meetings AS RESTRICTIVE FOR INSERT TO hub_api WITH CHECK (
        EXISTS (SELECT 1 FROM hub.leads l WHERE l.id = meetings.lead_id AND l.project_id = meetings.project_id));
      REVOKE UPDATE ON hub.meetings FROM hub_api;

      CREATE FUNCTION hub_private.complete_meeting(target uuid, appointment uuid, result text) RETURNS text
      LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
      DECLARE m hub.meetings%ROWTYPE;
      BEGIN
        IF COALESCE(hub_private.project_role(target),'') NOT IN ('closer','leader','admin')
            OR auth.uid() IS NULL THEN RETURN 'missing'; END IF;
        IF result IS NULL OR result NOT IN ('qualified','not_qualified','no_show','offer_sent','sold')
            THEN RETURN 'invalid'; END IF;

        SELECT * INTO m FROM hub.meetings WHERE id=appointment AND project_id=target
          AND closer_id=auth.uid() FOR UPDATE;
        IF NOT FOUND THEN RETURN 'missing'; END IF;
        IF m.outcome=result THEN RETURN 'already_saved'; END IF;
        IF m.outcome<>'booked' THEN RETURN 'finalized'; END IF;
        IF m.ends_at > now() THEN RETURN 'future'; END IF;

        IF result='sold' AND NOT EXISTS (SELECT 1 FROM hub.sales s WHERE s.lead_id=m.lead_id
           AND s.project_id=m.project_id AND s.partner_id=m.partner_id) THEN RETURN 'missing_sale'; END IF;
        IF result='offer_sent' THEN
          UPDATE hub.leads SET pipeline_step=greatest(pipeline_step,6) WHERE id=m.lead_id AND
            project_id=m.project_id AND partner_id=m.partner_id AND status NOT IN ('sold','declined');
        END IF;
        UPDATE hub.meetings SET outcome=result WHERE id=m.id;
        RETURN 'saved';
      END $$;
      REVOKE ALL ON FUNCTION hub_private.complete_meeting(uuid,uuid,text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION hub_private.complete_meeting(uuid,uuid,text) TO hub_api;
    """)


def downgrade():
    raise RuntimeError("Bevar møtehistorikken. Bruk en gjennomgått fremovermigrering.")
