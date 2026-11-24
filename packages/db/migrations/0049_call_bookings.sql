-- Callbacks and demos booked by the AI during a call: the booking flow collects the name, the day and the time (India time).
CREATE TABLE IF NOT EXISTS call_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
  call_id uuid,
  booked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  caller_name text NOT NULL,
  scheduled_for timestamptz NOT NULL,
  language text NOT NULL DEFAULT 'en',
  status text NOT NULL DEFAULT 'requested',
  source text NOT NULL DEFAULT 'voice_ai',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT call_bookings_status_chk CHECK (status IN ('requested','confirmed','done','cancelled')),
  CONSTRAINT call_bookings_language_chk CHECK (language IN ('en','hi','hinglish'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS call_bookings_org_time_idx ON call_bookings (org_id, scheduled_for);--> statement-breakpoint
ALTER TABLE call_bookings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON call_bookings AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY platform_all ON call_bookings AS PERMISSIVE FOR ALL TO public USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voiceai_app') THEN
    EXECUTE 'GRANT ALL ON TABLE call_bookings TO voiceai_app';
  END IF;
END $$;
