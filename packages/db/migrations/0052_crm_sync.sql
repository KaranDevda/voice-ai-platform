-- Two-way CRM sync: contacts the CRM sends in (logged here), each endpoint's last health check, and no echo: a change that came
-- from the CRM is not sent back to it as a webhook.
ALTER TABLE crm_endpoints ADD COLUMN IF NOT EXISTS last_health_status text;--> statement-breakpoint
ALTER TABLE crm_endpoints ADD COLUMN IF NOT EXISTS last_health_json jsonb;--> statement-breakpoint
ALTER TABLE crm_endpoints ADD COLUMN IF NOT EXISTS last_checked_at timestamptz;--> statement-breakpoint
ALTER TABLE crm_endpoints DROP CONSTRAINT IF EXISTS crm_endpoints_health_chk;--> statement-breakpoint
ALTER TABLE crm_endpoints ADD CONSTRAINT crm_endpoints_health_chk CHECK (last_health_status IS NULL OR last_health_status IN ('ok','degraded','down'));--> statement-breakpoint
CREATE TABLE IF NOT EXISTS crm_inbound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  received integer NOT NULL,
  created integer NOT NULL,
  updated integer NOT NULL,
  status_changes integer NOT NULL DEFAULT 0,
  invalid integer NOT NULL,
  problems jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS crm_inbound_events_org_idx ON crm_inbound_events (org_id, created_at);--> statement-breakpoint
ALTER TABLE crm_inbound_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON crm_inbound_events AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY platform_all ON crm_inbound_events AS PERMISSIVE FOR ALL TO public USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voiceai_app') THEN
    EXECUTE 'GRANT ALL ON TABLE crm_inbound_events TO voiceai_app';
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION crm_emit(p_org uuid, p_event text, p_data jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO crm_deliveries (org_id, endpoint_id, event, payload)
  SELECT p_org, e.id, p_event, jsonb_build_object('event', p_event, 'created_at', now(), 'data', p_data)
    FROM crm_endpoints e
   WHERE e.org_id = p_org AND e.active AND p_event = ANY (e.events)
     AND coalesce(current_setting('app.crm_sync', true), '') <> 'on'
$$;
