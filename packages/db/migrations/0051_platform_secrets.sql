-- Provider keys set from the website by platform staff (carrier, payment gateways, AI, KYC, e-mail). Stored encrypted; only the
-- last four characters are kept readable so staff can recognise a key. Platform staff only: no organisation can read them.
CREATE TABLE IF NOT EXISTS platform_secrets (
  name text PRIMARY KEY,
  value_enc text NOT NULL,
  hint text,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_secrets_name_chk CHECK (name ~ '^[A-Z][A-Z0-9_]{2,63}$')
);--> statement-breakpoint
ALTER TABLE platform_secrets ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY platform_all ON platform_secrets AS PERMISSIVE FOR ALL TO public USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voiceai_app') THEN
    EXECUTE 'GRANT ALL ON TABLE platform_secrets TO voiceai_app';
  END IF;
END $$;
