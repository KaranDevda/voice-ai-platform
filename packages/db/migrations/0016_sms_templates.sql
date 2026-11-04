CREATE TABLE "sms_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"body" text NOT NULL,
	"dlt_template_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "sms_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sms_templates" ADD CONSTRAINT "sms_templates_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
CREATE UNIQUE INDEX "sms_templates_org_name_uq" ON "sms_templates" USING btree ("org_id","name");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "sms_templates" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- The sender now also gets the person's name and custom columns, so {{name}} style words in a text can be filled in just before sending.
DROP FUNCTION IF EXISTS worker_sms_claim(integer);--> statement-breakpoint
CREATE FUNCTION worker_sms_claim(p_limit integer DEFAULT 20)
RETURNS TABLE (id uuid, org_id uuid, phone text, body text, dlt_template_id text, person_name text, person_fields jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  UPDATE sms_messages m SET status = 'failed', error = 'Do Not Disturb or no consent'
    FROM leads l WHERE l.id = m.lead_id AND m.direction = 'outbound' AND m.status = 'queued' AND (l.dnd_flag OR l.consent_status IN ('denied', 'withdrawn'));
  RETURN QUERY
  WITH due AS (
    SELECT m.id FROM sms_messages m
      JOIN organizations o ON o.id = m.org_id
     WHERE m.direction = 'outbound' AND m.status = 'queued' AND m.lead_id IS NOT NULL
       AND (now() AT TIME ZONE 'Asia/Kolkata')::time >= coalesce(o.settings_json->'calling'->>'windowStart', '09:00')::time
       AND (now() AT TIME ZONE 'Asia/Kolkata')::time <  coalesce(o.settings_json->'calling'->>'windowEnd', '21:00')::time
     ORDER BY m.created_at LIMIT greatest(1, least(p_limit, 50)) FOR UPDATE OF m SKIP LOCKED
  ), claimed AS (
    UPDATE sms_messages m SET status = 'sending' WHERE m.id IN (SELECT d.id FROM due d)
    RETURNING m.id, m.org_id, m.lead_id, m.body, m.dlt_template_id
  )
  SELECT c.id, c.org_id, l.phone_e164, c.body, c.dlt_template_id, l.name, l.custom_fields FROM claimed c JOIN leads l ON l.id = c.lead_id;
END $$;
