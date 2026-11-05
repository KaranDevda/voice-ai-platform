-- Campaigns that play a pre-recorded message (an MP3 or WAV the organisation uploads) instead of holding an AI conversation.
-- mode "ai" (the default, as before) or "audio". The recording is kept with the campaign (at most 5 MB) and played when the person answers.
ALTER TABLE "campaigns" ADD COLUMN "mode" text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_mode_chk" CHECK ("mode" IN ('ai', 'audio'));--> statement-breakpoint
CREATE TABLE "campaign_audio" (
	"campaign_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mime" text NOT NULL,
	"data" bytea NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_audio_mime_chk" CHECK ("mime" IN ('audio/mpeg', 'audio/wav')),
	CONSTRAINT "campaign_audio_size_chk" CHECK (octet_length("data") BETWEEN 1000 AND 5242880)
);--> statement-breakpoint
ALTER TABLE "campaign_audio" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_audio" ADD CONSTRAINT "campaign_audio_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "campaign_audio" ADD CONSTRAINT "campaign_audio_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "campaign_audio" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
DROP FUNCTION worker_campaign_tick(integer);--> statement-breakpoint
CREATE FUNCTION worker_campaign_tick(p_limit integer DEFAULT 10)
RETURNS TABLE (target_id uuid, campaign_id uuid, org_id uuid, lead_id uuid, language text, voice text, created_by uuid, detect_machines boolean, opening text, mode text)
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
    UPDATE campaign_targets t SET status = 'calling', attempts = t.attempts + 1, called_at = now(),
        variant = coalesce(t.variant, CASE WHEN cardinality(c2.opening_variants) > 0 THEN (abs(hashtext(t.id::text)) % cardinality(c2.opening_variants)) + 1 END)
      FROM campaigns c2
     WHERE c2.id = t.campaign_id AND t.id IN (SELECT id FROM pick) AND t.status = 'pending'
    RETURNING t.id, t.campaign_id, t.org_id, t.lead_id, t.variant
  )
  SELECT cl.id, cl.campaign_id, cl.org_id, cl.lead_id, c.language, c.voice, c.created_by, c.detect_machines,
         CASE WHEN cl.variant IS NOT NULL THEN c.opening_variants[cl.variant] END, c.mode
    FROM claimed cl JOIN campaigns c ON c.id = cl.campaign_id;
  -- numbers that can never be called (Do Not Disturb, consent) are closed, not left waiting
  UPDATE campaign_targets t SET status = 'skipped', last_error = CASE WHEN l.dnd_flag THEN 'Do Not Disturb' ELSE 'no consent' END
    FROM leads l, campaigns c
   WHERE l.id = t.lead_id AND c.id = t.campaign_id AND c.status = 'running' AND t.status = 'pending' AND (l.dnd_flag OR l.consent_status IN ('denied', 'withdrawn'));
END $$;
