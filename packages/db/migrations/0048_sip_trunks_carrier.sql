-- Which carrier each number belongs to, and customer SIP trunks (BYOC, Twilio Elastic SIP Trunking).
ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS carrier text NOT NULL DEFAULT 'plivo';--> statement-breakpoint
ALTER TABLE phone_numbers DROP CONSTRAINT IF EXISTS phone_numbers_carrier_chk;--> statement-breakpoint
ALTER TABLE phone_numbers ADD CONSTRAINT phone_numbers_carrier_chk CHECK (carrier IN ('plivo','twilio'));--> statement-breakpoint
ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS trunk_id uuid;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS sip_trunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  carrier text NOT NULL DEFAULT 'twilio',
  provider_trunk_sid text NOT NULL,
  termination_domain text,
  origination_urls text[] NOT NULL DEFAULT '{}',
  last_health_status text,
  last_health_json jsonb,
  last_checked_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sip_trunks_carrier_chk CHECK (carrier IN ('twilio')),
  CONSTRAINT sip_trunks_health_chk CHECK (last_health_status IS NULL OR last_health_status IN ('ok','degraded','down'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS sip_trunks_provider_sid_uq ON sip_trunks (provider_trunk_sid);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sip_trunks_org_idx ON sip_trunks (org_id);--> statement-breakpoint
ALTER TABLE phone_numbers DROP CONSTRAINT IF EXISTS phone_numbers_trunk_id_fk;--> statement-breakpoint
ALTER TABLE phone_numbers ADD CONSTRAINT phone_numbers_trunk_id_fk FOREIGN KEY (trunk_id) REFERENCES sip_trunks(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE sip_trunks ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON sip_trunks AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY platform_all ON sip_trunks AS PERMISSIVE FOR ALL TO public USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voiceai_app') THEN
    EXECUTE 'GRANT ALL ON TABLE sip_trunks TO voiceai_app';
  END IF;
END $$;
