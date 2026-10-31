REVOKE ALL ON SCHEMA hub, hub_private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA hub, hub_private TO hub_api;
GRANT USAGE ON SCHEMA hub TO hub_worker;
GRANT USAGE ON SCHEMA auth TO hub_api;
GRANT EXECUTE ON FUNCTION auth.uid() TO hub_api;

CREATE FUNCTION hub_private.project_role(target uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT role FROM hub.memberships
  WHERE project_id = target AND user_id = auth.uid() AND active
$$;
REVOKE ALL ON FUNCTION hub_private.project_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hub_private.project_role(uuid) TO hub_api;

CREATE FUNCTION hub_private.closer_allowed(target uuid, person uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT hub_private.project_role(target) IS NOT NULL AND EXISTS (
   SELECT 1 FROM hub.memberships WHERE project_id = target AND user_id = person
   AND active AND role IN ('closer','leader','admin')
 )
$$;
REVOKE ALL ON FUNCTION hub_private.closer_allowed(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hub_private.closer_allowed(uuid, uuid) TO hub_api;

CREATE FUNCTION hub_private.project_closers(target uuid) RETURNS TABLE(id uuid, name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT m.user_id, COALESCE(NULLIF(u.raw_user_meta_data->>'display_name', ''), 'Closer')
 FROM hub.memberships m JOIN auth.users u ON u.id = m.user_id
 WHERE m.project_id = target AND m.active AND m.role IN ('closer','leader','admin')
 AND hub_private.project_role(target) IS NOT NULL
$$;
REVOKE ALL ON FUNCTION hub_private.project_closers(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION hub_private.project_closers(uuid) TO hub_api;

ALTER TABLE hub.memberships ADD CONSTRAINT membership_identity FOREIGN KEY (user_id) REFERENCES auth.users(id);

ALTER TABLE hub.memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON hub.memberships FOR SELECT TO hub_api
USING (user_id = auth.uid() OR hub_private.project_role(project_id) IN ('leader','admin'));
CREATE POLICY membership_write ON hub.memberships FOR ALL TO hub_api
USING (hub_private.project_role(project_id) IN ('leader','admin'))
WITH CHECK (hub_private.project_role(project_id) IN ('leader','admin'));
GRANT SELECT, INSERT, UPDATE ON hub.memberships TO hub_api;

ALTER TABLE hub.partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY partner_read ON hub.partners FOR SELECT TO hub_api USING (
 EXISTS (SELECT 1 FROM hub.projects p WHERE p.partner_id = partners.id AND hub_private.project_role(p.id) IS NOT NULL)
);
GRANT SELECT ON hub.partners TO hub_api;

ALTER TABLE hub.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_read ON hub.projects FOR SELECT TO hub_api USING (hub_private.project_role(id) IS NOT NULL);
GRANT SELECT ON hub.projects TO hub_api;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['leads','registry_checks','consents','calls','products','meetings','jobs','audit_events'] LOOP
    EXECUTE format('ALTER TABLE hub.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY scoped_read ON hub.%I FOR SELECT TO hub_api USING (hub_private.project_role(project_id) IS NOT NULL)', t);
    EXECUTE format('GRANT SELECT ON hub.%I TO hub_api', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['leads','calls','meetings'] LOOP
    EXECUTE format('CREATE POLICY scoped_write ON hub.%I FOR ALL TO hub_api USING (hub_private.project_role(project_id) IN (''seller'',''booker'',''closer'',''leader'',''admin'')) WITH CHECK (hub_private.project_role(project_id) IN (''seller'',''booker'',''closer'',''leader'',''admin''))', t);
    EXECUTE format('GRANT INSERT, UPDATE ON hub.%I TO hub_api', t);
  END LOOP;
END $$;

ALTER TABLE hub.sales ENABLE ROW LEVEL SECURITY;
-- Personal compensation is visible only to the seller and authorized managers.
CREATE POLICY sale_read ON hub.sales FOR SELECT TO hub_api USING (
 hub_private.project_role(project_id) IN ('leader','admin') OR
 (seller_id = auth.uid() AND hub_private.project_role(project_id) IS NOT NULL)
);
CREATE POLICY sale_create ON hub.sales FOR INSERT TO hub_api WITH CHECK (
 seller_id = auth.uid() AND hub_private.project_role(project_id) IN ('seller','closer','leader','admin')
);
CREATE POLICY sale_approve ON hub.sales FOR UPDATE TO hub_api
USING (hub_private.project_role(project_id) IN ('leader','admin'))
WITH CHECK (hub_private.project_role(project_id) IN ('leader','admin'));
GRANT SELECT, INSERT ON hub.sales TO hub_api;
GRANT UPDATE (status, approved_by) ON hub.sales TO hub_api;

ALTER TABLE hub.sales ADD CONSTRAINT allocation_balances CHECK (
 allocation ?& ARRAY['hub','seller','partner'] AND
 (allocation->>'hub')::bigint >= 0 AND (allocation->>'seller')::bigint >= 0 AND
 (allocation->>'partner')::bigint >= 0 AND
 (allocation->>'hub')::bigint + (allocation->>'seller')::bigint + (allocation->>'partner')::bigint = amount_ore
);

CREATE POLICY audit_append ON hub.audit_events FOR INSERT TO hub_api
WITH CHECK (actor_id = auth.uid() AND hub_private.project_role(project_id) IS NOT NULL);
GRANT INSERT ON hub.audit_events TO hub_api;
CREATE POLICY job_append ON hub.jobs FOR INSERT TO hub_api
WITH CHECK (hub_private.project_role(project_id) IN ('leader','admin','seller','booker','closer'));
GRANT INSERT ON hub.jobs TO hub_api;

-- Worker has only enrichment/job privileges, no financial or authentication writes.
CREATE POLICY worker_jobs ON hub.jobs FOR ALL TO hub_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_leads ON hub.leads FOR SELECT TO hub_worker USING (kind = 'b2b');
CREATE POLICY worker_enrichment ON hub.leads FOR UPDATE TO hub_worker USING (kind = 'b2b') WITH CHECK (kind = 'b2b');
GRANT SELECT, UPDATE ON hub.jobs TO hub_worker;
GRANT SELECT ON hub.leads TO hub_worker;
GRANT UPDATE (enrichment, industry, city) ON hub.leads TO hub_worker;

CREATE INDEX leads_queue ON hub.leads(project_id, status, priority DESC);
CREATE INDEX jobs_pending ON hub.jobs(available_at) WHERE status = 'pending';
CREATE INDEX membership_user ON hub.memberships(user_id, project_id) WHERE active;
CREATE INDEX registry_lead ON hub.registry_checks(lead_id, checked_at DESC);

-- Separate from tenant data, global busy intervals prevent cross-project double booking.
CREATE FUNCTION hub_private.guard_meeting() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.closer_id::text, 0));
 IF EXISTS (SELECT 1 FROM hub.meetings m WHERE m.closer_id = NEW.closer_id AND m.id <> NEW.id
   AND m.outcome <> 'cancelled' AND NEW.outcome <> 'cancelled'
   AND tstzrange(m.starts_at, m.ends_at, '[)') && tstzrange(NEW.starts_at, NEW.ends_at, '[)')) THEN
   RAISE EXCEPTION 'Closer unavailable' USING ERRCODE = '23P01';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hub_private.guard_meeting() FROM PUBLIC;
CREATE TRIGGER meeting_overlap BEFORE INSERT OR UPDATE ON hub.meetings
FOR EACH ROW EXECUTE FUNCTION hub_private.guard_meeting();
