ALTER TABLE "call_analysis_attempts" ADD COLUMN "rerun" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- The worker also picks up calls whose analysis a person asked to run again (they already have insights, so the first function skipped them).
CREATE OR REPLACE FUNCTION worker_pending_analysis(p_limit integer)
RETURNS TABLE (call_log_id uuid, org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.org_id
  FROM call_logs c
  JOIN call_transcripts t ON t.call_log_id = c.id
  LEFT JOIN call_insights i ON i.call_log_id = c.id
  LEFT JOIN call_analysis_attempts a ON a.call_log_id = c.id
  WHERE (i.call_log_id IS NULL OR COALESCE(a.rerun, false))
    AND c.created_at < now() - interval '5 seconds'
    AND jsonb_array_length(t.segments) > 0
    AND (a.call_log_id IS NULL OR (a.attempts < 5 AND a.next_try_at <= now()))
  ORDER BY c.created_at
  LIMIT greatest(1, least(p_limit, 50))
$$;
--> statement-breakpoint
-- Retention (SOP: the organisation chooses how long recordings and transcripts are kept). The worker is not a signed-in person, so these two
-- SECURITY DEFINER functions are its only way to find what has expired across organisations. They return ids and keys, never content.
CREATE OR REPLACE FUNCTION worker_expired_recordings(p_limit integer)
RETURNS TABLE (call_log_id uuid, org_id uuid, recording_key text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.org_id, c.recording_key
  FROM call_logs c JOIN organizations o ON o.id = c.org_id
  WHERE c.recording_key IS NOT NULL AND c.started_at < now() - make_interval(days => o.recording_retention_days)
  ORDER BY c.started_at LIMIT greatest(1, least(p_limit, 500))
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION worker_expired_transcripts(p_limit integer)
RETURNS TABLE (call_log_id uuid, org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.org_id
  FROM call_logs c JOIN organizations o ON o.id = c.org_id
  WHERE c.started_at < now() - make_interval(days => o.data_retention_days)
    AND (EXISTS (SELECT 1 FROM call_transcripts t WHERE t.call_log_id = c.id) OR EXISTS (SELECT 1 FROM call_insights i WHERE i.call_log_id = c.id))
  ORDER BY c.started_at LIMIT greatest(1, least(p_limit, 500))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION worker_pending_analysis(integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION worker_expired_recordings(integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION worker_expired_transcripts(integer) FROM PUBLIC;
