ALTER TABLE hub.leads ADD COLUMN review_required boolean NOT NULL DEFAULT false;
-- Keep the API assignment guard without requiring worker access to role helpers.
CREATE OR REPLACE FUNCTION hub_private.guard_list_assignment() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF current_user = 'hub_api' THEN
   IF (TG_OP = 'INSERT' OR OLD.call_list_id IS DISTINCT FROM NEW.call_list_id)
      AND (TG_OP <> 'INSERT' OR NEW.call_list_id IS NOT NULL)
      AND hub_private.project_role(NEW.project_id) NOT IN ('leader','admin') THEN
     RAISE EXCEPTION 'List assignment requires manager' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END $$;
-- Existing duplicates must be resolved explicitly; never delete customer data here.
CREATE UNIQUE INDEX lead_project_org ON hub.leads(project_id, org_number)
  WHERE kind='b2b' AND org_number IS NOT NULL AND org_number <> '';

CREATE TABLE hub.discovery_settings (
  id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
  project_id uuid NOT NULL UNIQUE, partner_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  municipality varchar(4) NOT NULL DEFAULT '0301' CHECK (municipality='0301'),
  daily_limit integer NOT NULL DEFAULT 20 CHECK (daily_limit BETWEEN 1 AND 20),
  industries jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(industries)='array' AND jsonb_array_length(industries)<=87),
  call_list_id uuid,
  page integer NOT NULL DEFAULT 0 CHECK(page>=0),
  "offset" integer NOT NULL DEFAULT 0 CHECK("offset" BETWEEN 0 AND 49),
  next_run_at timestamptz NOT NULL DEFAULT now(), last_run_at timestamptz,
  last_summary jsonb NOT NULL DEFAULT '{}', last_error text,
  UNIQUE(id,project_id,partner_id),
  FOREIGN KEY(project_id,partner_id) REFERENCES hub.projects(id,partner_id),
  FOREIGN KEY(call_list_id,project_id,partner_id) REFERENCES hub.call_lists(id,project_id,partner_id),
  CHECK (NOT enabled OR call_list_id IS NOT NULL)
);
CREATE TABLE hub.discovery_records (
  id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
  project_id uuid NOT NULL, partner_id uuid NOT NULL,
  org_number varchar(9) NOT NULL CHECK(org_number ~ '^[0-9]{9}$'), company varchar(200) NOT NULL,
  status varchar(30) NOT NULL CHECK(status IN ('imported','review','duplicate','excluded','rejected')),
  reason varchar(200) NOT NULL, lead_id uuid, source_url text NOT NULL,
  UNIQUE(id,project_id,partner_id), UNIQUE(project_id,org_number),
  FOREIGN KEY(project_id,partner_id) REFERENCES hub.projects(id,partner_id),
  FOREIGN KEY(lead_id,project_id,partner_id) REFERENCES hub.leads(id,project_id,partner_id)
);
CREATE INDEX discovery_history ON hub.discovery_records(project_id,created_at DESC,id);
CREATE INDEX discovery_due ON hub.discovery_settings(next_run_at) WHERE enabled;
CREATE INDEX discovery_daily ON hub.leads(project_id,created_at) WHERE source='brreg_discovery';
ALTER TABLE hub.discovery_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hub.discovery_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY discovery_settings_manager ON hub.discovery_settings FOR ALL TO hub_api
 USING(hub_private.project_role(project_id) IN ('leader','admin'))
 WITH CHECK(hub_private.project_role(project_id) IN ('leader','admin'));
CREATE POLICY discovery_records_manager ON hub.discovery_records FOR ALL TO hub_api
 USING(hub_private.project_role(project_id) IN ('leader','admin'))
 WITH CHECK(hub_private.project_role(project_id) IN ('leader','admin'));
GRANT SELECT, INSERT ON hub.discovery_settings TO hub_api;
GRANT UPDATE(enabled,industries,call_list_id,page,"offset",next_run_at,last_error) ON hub.discovery_settings TO hub_api;
GRANT SELECT, UPDATE(status,reason) ON hub.discovery_records TO hub_api;
CREATE POLICY discovery_worker_settings ON hub.discovery_settings FOR ALL TO hub_worker USING(true) WITH CHECK(true);
CREATE POLICY discovery_worker_records ON hub.discovery_records FOR ALL TO hub_worker
 USING(EXISTS(SELECT 1 FROM hub.discovery_settings s WHERE s.project_id=discovery_records.project_id AND s.partner_id=discovery_records.partner_id))
 WITH CHECK(EXISTS(SELECT 1 FROM hub.discovery_settings s WHERE s.project_id=discovery_records.project_id AND s.partner_id=discovery_records.partner_id AND s.enabled));
GRANT SELECT ON hub.discovery_settings,hub.discovery_records TO hub_worker;
GRANT UPDATE(page,"offset",next_run_at,last_run_at,last_summary,last_error) ON hub.discovery_settings TO hub_worker;
GRANT INSERT ON hub.discovery_records TO hub_worker;
CREATE POLICY discovery_worker_project ON hub.projects FOR SELECT TO hub_worker
 USING(EXISTS(SELECT 1 FROM hub.discovery_settings s WHERE s.project_id=projects.id AND s.partner_id=projects.partner_id));
CREATE POLICY discovery_worker_queue ON hub.call_lists FOR SELECT TO hub_worker
 USING(EXISTS(SELECT 1 FROM hub.discovery_settings s WHERE s.call_list_id=call_lists.id AND s.project_id=call_lists.project_id));
GRANT SELECT ON hub.projects,hub.call_lists TO hub_worker;
CREATE POLICY discovery_worker_create ON hub.leads FOR INSERT TO hub_worker
 WITH CHECK(kind='b2b' AND source='brreg_discovery' AND EXISTS(
   SELECT 1 FROM hub.discovery_settings s JOIN hub.projects p ON p.id=s.project_id
   WHERE s.project_id=leads.project_id AND s.partner_id=leads.partner_id AND s.enabled AND p.active AND p.kind IN ('b2b','both')));
GRANT INSERT(id,partner_id,project_id,call_list_id,company,contact,phone,org_number,kind,status,priority,
 industry,city,source,summary,enrichment,blocked,review_required,reserved_by,reserved_until,callback_at,queue_completed_at)
 ON hub.leads TO hub_worker;
CREATE POLICY discovery_job_create ON hub.jobs AS RESTRICTIVE FOR INSERT TO hub_worker WITH CHECK(
 kind='brreg_enrichment' AND EXISTS(SELECT 1 FROM hub.leads l WHERE l.id::text=jobs.payload->>'lead_id'
 AND l.project_id=jobs.project_id AND l.partner_id=jobs.partner_id AND l.source='brreg_discovery'));
GRANT INSERT ON hub.jobs TO hub_worker;

CREATE FUNCTION hub_private.guard_discovery_import() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE cfg hub.discovery_settings; used integer;
BEGIN
 IF current_user <> 'hub_worker' THEN RETURN NEW; END IF;
 SELECT * INTO cfg FROM hub.discovery_settings WHERE project_id=NEW.project_id AND partner_id=NEW.partner_id FOR UPDATE;
 IF NOT FOUND OR NOT cfg.enabled OR NEW.source<>'brreg_discovery' OR NEW.kind<>'b2b'
 OR NEW.status<>'new' OR NEW.city<>'Oslo' OR NEW.org_number !~ '^[0-9]{9}$' OR NEW.org_number IS NULL
 OR (NOT NEW.review_required AND NEW.phone !~ '^\+47[2-9][0-9]{7}$')
 OR (NEW.review_required AND NEW.call_list_id IS NOT NULL)
 OR (NOT NEW.review_required AND NEW.call_list_id IS DISTINCT FROM cfg.call_list_id)
 OR NOT EXISTS(SELECT 1 FROM hub.call_lists WHERE id=cfg.call_list_id AND category='cold') THEN
   RAISE EXCEPTION 'Invalid discovery import' USING ERRCODE='23514';
 END IF;
 NEW.created_at := clock_timestamp();
 SELECT count(*) INTO used FROM hub.leads WHERE project_id=NEW.project_id AND source='brreg_discovery'
 AND created_at >= (date_trunc('day',NEW.created_at AT TIME ZONE 'Europe/Oslo') AT TIME ZONE 'Europe/Oslo');
 IF used >= cfg.daily_limit THEN RAISE EXCEPTION 'Daily discovery quota reached' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION hub_private.guard_discovery_import() FROM PUBLIC;
CREATE TRIGGER discovery_import_guard BEFORE INSERT ON hub.leads FOR EACH ROW EXECUTE FUNCTION hub_private.guard_discovery_import();
