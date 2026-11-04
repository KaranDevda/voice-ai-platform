CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"language" text DEFAULT 'en-hi' NOT NULL,
	"voice" text,
	"start_at" timestamp with time zone,
	"max_concurrent" integer DEFAULT 2 NOT NULL,
	"max_attempts" integer DEFAULT 2 NOT NULL,
	"retry_delay_min" integer DEFAULT 60 NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "campaigns_status_chk" CHECK ("status" IN ('draft','scheduled','running','paused','completed','cancelled')),
	CONSTRAINT "campaigns_limits_chk" CHECK ("max_concurrent" BETWEEN 1 AND 20 AND "max_attempts" BETWEEN 1 AND 5 AND "retry_delay_min" BETWEEN 5 AND 1440)
);--> statement-breakpoint
CREATE TABLE "campaign_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"called_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_targets_status_chk" CHECK ("status" IN ('pending','calling','done','failed','skipped'))
);--> statement-breakpoint
ALTER TABLE "campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_targets" ADD CONSTRAINT "campaign_targets_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campaign_targets_campaign_lead_uq" ON "campaign_targets" USING btree ("campaign_id","lead_id");--> statement-breakpoint
CREATE INDEX "campaign_targets_due_idx" ON "campaign_targets" USING btree ("campaign_id","status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "campaigns_org_created_idx" ON "campaigns" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "campaigns" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "campaign_targets" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- The campaign runner (worker) has no organisation context, so like the post-call worker it goes through these functions.
-- One tick: starts campaigns whose time has come, settles calls that finished, completes finished campaigns, and hands out the next
-- numbers to dial, never more than a campaign's concurrency limit. Do Not Disturb and withdrawn or denied consent are skipped here too
-- (the voice service checks them again, and the calling hours, before dialling). Run by ONE worker.
CREATE OR REPLACE FUNCTION worker_campaign_tick(p_limit integer DEFAULT 10)
RETURNS TABLE (target_id uuid, campaign_id uuid, org_id uuid, lead_id uuid, language text, voice text, created_by uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  UPDATE campaigns c SET status = 'running', started_at = coalesce(c.started_at, now()) WHERE c.status = 'scheduled' AND c.start_at <= now();
  -- a call that finished: connected means done, anything else is another try later (or failed after the last try)
  UPDATE campaign_targets t SET status = 'done', last_error = NULL
   WHERE t.status = 'calling' AND EXISTS (SELECT 1 FROM call_logs l WHERE l.lead_id = t.lead_id AND l.source = 'ai_outbound' AND l.created_at >= t.called_at AND l.status = 'connected');
  UPDATE campaign_targets t SET
      status = CASE WHEN t.attempts >= c.max_attempts THEN 'failed' ELSE 'pending' END,
      next_attempt_at = now() + make_interval(mins => c.retry_delay_min),
      last_error = CASE WHEN EXISTS (SELECT 1 FROM call_logs l WHERE l.lead_id = t.lead_id AND l.source = 'ai_outbound' AND l.created_at >= t.called_at) THEN 'not answered' ELSE 'no result from the phone line' END
    FROM campaigns c
   WHERE c.id = t.campaign_id AND t.status = 'calling'
     AND (EXISTS (SELECT 1 FROM call_logs l WHERE l.lead_id = t.lead_id AND l.source = 'ai_outbound' AND l.created_at >= t.called_at AND l.status <> 'connected')
          OR t.called_at < now() - interval '15 minutes');
  UPDATE campaigns c SET status = 'completed', finished_at = now()
   WHERE c.status = 'running' AND NOT EXISTS (SELECT 1 FROM campaign_targets t WHERE t.campaign_id = c.id AND t.status IN ('pending', 'calling'));
  RETURN QUERY
  WITH slots AS (
    SELECT c.id AS cid, c.max_concurrent - (SELECT count(*) FROM campaign_targets x WHERE x.campaign_id = c.id AND x.status = 'calling') AS free
      FROM campaigns c WHERE c.status = 'running'
  ), due AS (
    SELECT t.id, t.campaign_id, row_number() OVER (PARTITION BY t.campaign_id ORDER BY t.next_attempt_at, t.created_at) AS rn
      FROM campaign_targets t JOIN leads l ON l.id = t.lead_id
     WHERE t.status = 'pending' AND t.next_attempt_at <= now() AND l.dnd_flag = false AND l.consent_status NOT IN ('denied', 'withdrawn')
  ), pick AS (
    SELECT d.id FROM due d JOIN slots s ON s.cid = d.campaign_id WHERE d.rn <= s.free ORDER BY d.rn LIMIT greatest(1, least(p_limit, 50))
  ), claimed AS (
    UPDATE campaign_targets t SET status = 'calling', attempts = t.attempts + 1, called_at = now()
     WHERE t.id IN (SELECT id FROM pick) AND t.status = 'pending'
    RETURNING t.id, t.campaign_id, t.org_id, t.lead_id
  )
  SELECT cl.id, cl.campaign_id, cl.org_id, cl.lead_id, c.language, c.voice, c.created_by FROM claimed cl JOIN campaigns c ON c.id = cl.campaign_id;
  -- numbers that can never be called (Do Not Disturb, consent) are closed, not left waiting
  UPDATE campaign_targets t SET status = 'skipped', last_error = CASE WHEN l.dnd_flag THEN 'Do Not Disturb' ELSE 'no consent' END
    FROM leads l, campaigns c
   WHERE l.id = t.lead_id AND c.id = t.campaign_id AND c.status = 'running' AND t.status = 'pending' AND (l.dnd_flag OR l.consent_status IN ('denied', 'withdrawn'));
END $$;--> statement-breakpoint
-- What happened when the runner asked the voice service to dial: 'hours' = outside calling hours (try again later, no attempt used),
-- 'skip' = must not be called, 'failed' = the phone line did not take it (counts as an attempt).
CREATE OR REPLACE FUNCTION worker_campaign_dial_result(p_target uuid, p_outcome text, p_error text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE campaign_targets t SET
      status = CASE p_outcome WHEN 'skip' THEN 'skipped' WHEN 'hours' THEN 'pending' ELSE CASE WHEN t.attempts >= c.max_attempts THEN 'failed' ELSE 'pending' END END,
      attempts = CASE p_outcome WHEN 'hours' THEN greatest(0, t.attempts - 1) ELSE t.attempts END,
      next_attempt_at = CASE p_outcome WHEN 'hours' THEN now() + interval '30 minutes' ELSE now() + make_interval(mins => c.retry_delay_min) END,
      last_error = left(coalesce(p_error, p_outcome), 200)
    FROM campaigns c WHERE c.id = t.campaign_id AND t.id = p_target AND t.status = 'calling';
END $$;
