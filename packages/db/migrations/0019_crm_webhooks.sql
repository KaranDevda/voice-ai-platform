-- CRM integration: the organisation gives us web addresses; we post them events (calls, analyses, leads) with a signature, log every
-- attempt, and retry failures with growing waits (1 min, 5 min, 30 min, 2 h, 12 h, 12 h) before giving up.
CREATE TABLE "crm_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text[] DEFAULT '{call.completed,call.analyzed,lead.created,lead.status_changed}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "crm_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"endpoint_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_status" integer,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "crm_deliveries_status_chk" CHECK ("status" IN ('pending','sending','delivered','failed'))
);--> statement-breakpoint
ALTER TABLE "crm_endpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "crm_endpoints" ADD CONSTRAINT "crm_endpoints_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
ALTER TABLE "crm_deliveries" ADD CONSTRAINT "crm_deliveries_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
ALTER TABLE "crm_deliveries" ADD CONSTRAINT "crm_deliveries_endpoint_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."crm_endpoints"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "crm_endpoints_org_idx" ON "crm_endpoints" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "crm_deliveries_due_idx" ON "crm_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "crm_deliveries_org_created_idx" ON "crm_deliveries" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "crm_endpoints" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "crm_deliveries" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- Queues one delivery per active endpoint that wants this event. Runs inside the triggers below, so every way a call or lead can be
-- created or changed is covered.
CREATE OR REPLACE FUNCTION crm_emit(p_org uuid, p_event text, p_data jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO crm_deliveries (org_id, endpoint_id, event, payload)
  SELECT p_org, e.id, p_event, jsonb_build_object('event', p_event, 'created_at', now(), 'data', p_data)
    FROM crm_endpoints e WHERE e.org_id = p_org AND e.active AND p_event = ANY (e.events)
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION crm_on_call() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM crm_emit(NEW.org_id, 'call.completed', jsonb_build_object('call_id', NEW.id, 'lead_id', NEW.lead_id, 'direction', NEW.direction, 'source', NEW.source, 'status', NEW.status, 'duration_s', NEW.duration_s, 'started_at', NEW.started_at));
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION crm_on_insight() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM crm_emit(NEW.org_id, 'call.analyzed', jsonb_build_object('call_id', NEW.call_log_id, 'summary', NEW.summary, 'sentiment', NEW.sentiment_label, 'sentiment_score', NEW.sentiment_score, 'intent', NEW.intent, 'next_action', NEW.next_action, 'suggested_status', NEW.suggested_status));
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION crm_on_lead_insert() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM crm_emit(NEW.org_id, 'lead.created', jsonb_build_object('lead_id', NEW.id, 'name', NEW.name, 'phone', NEW.phone_e164, 'email', NEW.email, 'tags', NEW.tags, 'source', NEW.source, 'status', NEW.status));
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION crm_on_lead_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM crm_emit(NEW.org_id, 'lead.status_changed', jsonb_build_object('lead_id', NEW.id, 'from', OLD.status, 'to', NEW.status));
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER crm_call_trg AFTER INSERT ON call_logs FOR EACH ROW EXECUTE FUNCTION crm_on_call();--> statement-breakpoint
CREATE TRIGGER crm_insight_trg AFTER INSERT ON call_insights FOR EACH ROW EXECUTE FUNCTION crm_on_insight();--> statement-breakpoint
CREATE TRIGGER crm_lead_insert_trg AFTER INSERT ON leads FOR EACH ROW EXECUTE FUNCTION crm_on_lead_insert();--> statement-breakpoint
CREATE TRIGGER crm_lead_status_trg AFTER UPDATE OF status ON leads FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status) EXECUTE FUNCTION crm_on_lead_status();--> statement-breakpoint
-- Hands the sender the deliveries that are due. A delivery that was handed out but never answered (the worker died) becomes due again after 5 minutes.
CREATE OR REPLACE FUNCTION worker_crm_claim(p_limit integer DEFAULT 20)
RETURNS TABLE (id uuid, event text, payload jsonb, url text, secret text, attempts integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  UPDATE crm_deliveries d SET status = 'pending' WHERE d.status = 'sending' AND d.next_attempt_at <= now();
  RETURN QUERY
  WITH due AS (
    SELECT d.id FROM crm_deliveries d JOIN crm_endpoints e ON e.id = d.endpoint_id AND e.active
     WHERE d.status = 'pending' AND d.next_attempt_at <= now()
     ORDER BY d.next_attempt_at LIMIT greatest(1, least(p_limit, 100)) FOR UPDATE OF d SKIP LOCKED
  ), claimed AS (
    UPDATE crm_deliveries d SET status = 'sending', attempts = d.attempts + 1, next_attempt_at = now() + interval '5 minutes'
     WHERE d.id IN (SELECT x.id FROM due x) RETURNING d.id, d.event, d.payload, d.endpoint_id, d.attempts
  )
  SELECT c.id, c.event, c.payload, e.url, e.secret, c.attempts FROM claimed c JOIN crm_endpoints e ON e.id = c.endpoint_id;
END $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION worker_crm_done(p_id uuid, p_ok boolean, p_status integer DEFAULT NULL, p_error text DEFAULT NULL) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE crm_deliveries SET
      status = CASE WHEN p_ok THEN 'delivered' WHEN attempts >= 6 THEN 'failed' ELSE 'pending' END,
      last_status = p_status, last_error = left(p_error, 300), delivered_at = CASE WHEN p_ok THEN now() END,
      next_attempt_at = now() + ((ARRAY[60, 300, 1800, 7200, 43200, 43200])[least(greatest(attempts, 1), 6)] * interval '1 second')
   WHERE id = p_id AND status = 'sending'
$$;
