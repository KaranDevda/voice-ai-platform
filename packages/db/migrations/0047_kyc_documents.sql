-- Identity documents (PAN card, GST certificate) attached to a KYC request. Small files kept in the database so they are covered by the same row-level security and backups.
CREATE TABLE IF NOT EXISTS kyc_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  submission_id uuid NOT NULL REFERENCES kyc_submissions(id) ON DELETE CASCADE,
  kind text NOT NULL,
  file_name text NOT NULL,
  mime text NOT NULL,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kyc_documents_kind_chk CHECK (kind IN ('pan','gst')),
  CONSTRAINT kyc_documents_size_chk CHECK (size_bytes BETWEEN 1 AND 2097152)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS kyc_documents_submission_idx ON kyc_documents (submission_id);--> statement-breakpoint
ALTER TABLE kyc_documents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_isolation ON kyc_documents AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY platform_all ON kyc_documents AS PERMISSIVE FOR ALL TO public USING (current_setting('app.platform', true) = 'on') WITH CHECK (current_setting('app.platform', true) = 'on');--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voiceai_app') THEN
    EXECUTE 'GRANT ALL ON TABLE kyc_documents TO voiceai_app';
  END IF;
END $$;
