CREATE TABLE agent_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  instructions text NOT NULL,
  knowledge_text text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT agent_profiles_org_name_uq UNIQUE (org_id, name)
);
--> statement-breakpoint
ALTER TABLE agent_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY org_isolation ON agent_profiles AS PERMISSIVE FOR ALL TO public
  USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'voiceai_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE agent_profiles TO voiceai_app';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE campaigns ADD COLUMN agent_profile_id uuid REFERENCES agent_profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE campaign_templates ADD COLUMN agent_profile_id uuid REFERENCES agent_profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
DROP FUNCTION worker_campaign_tick(integer);
--> statement-breakpoint
CREATE FUNCTION worker_campaign_tick(p_limit integer DEFAULT 10)
RETURNS TABLE (target_id uuid, campaign_id uuid, org_id uuid, lead_id uuid, language text, voice text, created_by uuid, detect_machines boolean, opening text, mode text, caller_id text, ai_model text, openrouter_model text, agent_profile_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  UPDATE campaigns c SET status = 'running', started_at = coalesce(c.started_at, now()) WHERE c.status = 'scheduled' AND c.start_at <= now();
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
         CASE WHEN cl.variant IS NOT NULL THEN c.opening_variants[cl.variant] END, c.mode, c.caller_id, c.ai_model, c.openrouter_model, c.agent_profile_id
    FROM claimed cl JOIN campaigns c ON c.id = cl.campaign_id;
  UPDATE campaign_targets t SET status = 'skipped', last_error = CASE WHEN l.dnd_flag THEN 'Do Not Disturb' ELSE 'no consent' END
    FROM leads l, campaigns c
   WHERE l.id = t.lead_id AND c.id = t.campaign_id AND c.status = 'running' AND t.status = 'pending' AND (l.dnd_flag OR l.consent_status IN ('denied', 'withdrawn'));
END $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION worker_campaign_tick(integer) TO voiceai_app;
