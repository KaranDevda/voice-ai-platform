CREATE TABLE "sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sequences_status_chk" CHECK ("status" IN ('active','archived'))
);--> statement-breakpoint
CREATE TABLE "sequence_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"delay_min" integer DEFAULT 0 NOT NULL,
	"body" text NOT NULL,
	"dlt_template_id" text,
	CONSTRAINT "sequence_steps_delay_chk" CHECK ("delay_min" BETWEEN 0 AND 43200)
);--> statement-breakpoint
CREATE TABLE "sequence_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"sequence_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"next_step" integer DEFAULT 0 NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sequence_enrollments_status_chk" CHECK ("status" IN ('active','paused','completed','stopped'))
);--> statement-breakpoint
CREATE TABLE "sms_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid,
	"direction" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"dlt_template_id" text,
	"provider_uuid" text,
	"error" text,
	"enrollment_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "sms_messages_direction_chk" CHECK ("direction" IN ('outbound','inbound')),
	CONSTRAINT "sms_messages_status_chk" CHECK ("status" IN ('queued','sending','sent','failed','received'))
);--> statement-breakpoint
ALTER TABLE "sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sequence_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sms_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_sequence_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_sequence_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."sequences"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
ALTER TABLE "sms_messages" ADD CONSTRAINT "sms_messages_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX "sequence_steps_position_uq" ON "sequence_steps" USING btree ("sequence_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "sequence_enrollments_uq" ON "sequence_enrollments" USING btree ("sequence_id","lead_id");--> statement-breakpoint
CREATE INDEX "sequence_enrollments_due_idx" ON "sequence_enrollments" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "sms_messages_queue_idx" ON "sms_messages" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "sms_messages_org_created_idx" ON "sms_messages" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "sequences" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "sequence_steps" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "sequence_enrollments" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "sms_messages" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- Worker functions (the worker has no organisation context). Messages are sent only inside each organisation's calling window (the same
-- hours as calls) and never to a person on Do Not Disturb or without consent.
CREATE OR REPLACE FUNCTION worker_sequence_tick(p_limit integer DEFAULT 50) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  UPDATE sequence_enrollments e SET status = 'stopped' FROM leads l
   WHERE l.id = e.lead_id AND e.status IN ('active', 'paused') AND (l.dnd_flag OR l.consent_status IN ('denied', 'withdrawn'));
  WITH due AS (
    SELECT e.id, e.org_id, e.lead_id, s.body, s.dlt_template_id
      FROM sequence_enrollments e
      JOIN sequences q ON q.id = e.sequence_id AND q.status = 'active'
      JOIN sequence_steps s ON s.sequence_id = e.sequence_id AND s.position = e.next_step
     WHERE e.status = 'active' AND e.next_run_at <= now()
     ORDER BY e.next_run_at LIMIT greatest(1, least(p_limit, 200)) FOR UPDATE OF e SKIP LOCKED
  ), queued AS (
    INSERT INTO sms_messages (org_id, lead_id, direction, body, status, dlt_template_id, enrollment_id)
    SELECT d.org_id, d.lead_id, 'outbound', d.body, 'queued', d.dlt_template_id, d.id FROM due d RETURNING enrollment_id
  )
  UPDATE sequence_enrollments e SET
      next_step = e.next_step + 1,
      next_run_at = now() + make_interval(mins => coalesce((SELECT n.delay_min FROM sequence_steps n WHERE n.sequence_id = e.sequence_id AND n.position = e.next_step + 1), 0)),
      status = CASE WHEN EXISTS (SELECT 1 FROM sequence_steps n WHERE n.sequence_id = e.sequence_id AND n.position = e.next_step + 1) THEN 'active' ELSE 'completed' END
   WHERE e.id IN (SELECT id FROM due);
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION worker_sms_claim(p_limit integer DEFAULT 20)
RETURNS TABLE (id uuid, org_id uuid, phone text, body text, dlt_template_id text)
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
  SELECT c.id, c.org_id, l.phone_e164, c.body, c.dlt_template_id FROM claimed c JOIN leads l ON l.id = c.lead_id;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION worker_sms_done(p_id uuid, p_ok boolean, p_provider_uuid text DEFAULT NULL, p_error text DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE sms_messages SET status = CASE WHEN p_ok THEN 'sent' ELSE 'failed' END, provider_uuid = p_provider_uuid, error = left(p_error, 300), sent_at = CASE WHEN p_ok THEN now() END
   WHERE id = p_id AND status = 'sending'
$$;--> statement-breakpoint
-- An incoming text: filed under the person (created if new). STOP, UNSUBSCRIBE or बंद switches Do Not Disturb on and ends their sequences.
CREATE OR REPLACE FUNCTION worker_sms_inbound(p_org uuid, p_from text, p_body text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lead uuid;
BEGIN
  SELECT id INTO v_lead FROM leads WHERE org_id = p_org AND phone_e164 = p_from;
  IF v_lead IS NULL THEN
    INSERT INTO leads (org_id, phone_e164, source) VALUES (p_org, p_from, 'sms_inbound') RETURNING id INTO v_lead;
  END IF;
  INSERT INTO sms_messages (org_id, lead_id, direction, body, status) VALUES (p_org, v_lead, 'inbound', left(p_body, 1600), 'received');
  IF lower(btrim(p_body)) IN ('stop', 'unsubscribe', 'cancel', 'end', 'quit', 'band', 'बंद') THEN
    UPDATE leads SET dnd_flag = true WHERE id = v_lead;
    UPDATE sequence_enrollments SET status = 'stopped' WHERE lead_id = v_lead AND status IN ('active', 'paused');
  END IF;
  RETURN v_lead;
END $$;
