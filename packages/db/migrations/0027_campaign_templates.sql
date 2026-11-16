-- Reusable campaign configurations. Targets and schedules are created afresh when used.
CREATE TABLE "campaign_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "org_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "name" text NOT NULL,
  "language" text DEFAULT 'en-hi' NOT NULL,
  "tags" text[] DEFAULT '{}'::text[] NOT NULL,
  "max_concurrent" integer DEFAULT 2 NOT NULL,
  "max_attempts" integer DEFAULT 2 NOT NULL,
  "retry_delay_min" integer DEFAULT 60 NOT NULL,
  "detect_machines" boolean DEFAULT true NOT NULL,
  "mode" text DEFAULT 'ai' NOT NULL,
  "opening_variants" text[] DEFAULT '{}'::text[] NOT NULL,
  "created_by" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "campaign_templates_language_chk" CHECK ("language" IN ('en', 'hi', 'en-hi')),
  CONSTRAINT "campaign_templates_tags_chk" CHECK (cardinality("tags") BETWEEN 1 AND 10),
  CONSTRAINT "campaign_templates_concurrent_chk" CHECK ("max_concurrent" BETWEEN 1 AND 20),
  CONSTRAINT "campaign_templates_attempts_chk" CHECK ("max_attempts" BETWEEN 1 AND 5),
  CONSTRAINT "campaign_templates_retry_chk" CHECK ("retry_delay_min" BETWEEN 5 AND 1440),
  CONSTRAINT "campaign_templates_mode_chk" CHECK ("mode" IN ('ai', 'audio')),
  CONSTRAINT "campaign_templates_variants_chk" CHECK (cardinality("opening_variants") = 0 OR cardinality("opening_variants") BETWEEN 2 AND 3),
  CONSTRAINT "campaign_templates_name_chk" CHECK (length(btrim("name")) BETWEEN 1 AND 120)
);
CREATE UNIQUE INDEX "campaign_templates_org_name_uq" ON "campaign_templates" USING btree ("org_id", "name");
CREATE INDEX "campaign_templates_org_created_idx" ON "campaign_templates" USING btree ("org_id", "created_at");
ALTER TABLE "campaign_templates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_isolation" ON "campaign_templates" AS PERMISSIVE FOR ALL TO public
  USING ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK ("org_id" = nullif(current_setting('app.org_id', true), '')::uuid);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voiceai_app') THEN
    EXECUTE 'GRANT ALL ON TABLE campaign_templates TO voiceai_app';
  END IF;
END $$;
