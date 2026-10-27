CREATE TABLE "call_analysis_attempts" (
	"call_log_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"next_try_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_analysis_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "call_analysis_attempts" ADD CONSTRAINT "call_analysis_attempts_call_log_id_call_logs_id_fk" FOREIGN KEY ("call_log_id") REFERENCES "public"."call_logs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_analysis_attempts" ADD CONSTRAINT "call_analysis_attempts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "call_analysis_attempts" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- The analysis worker is not a signed-in person, so it has no organisation to scope to and RLS would hide every call from it.
-- This SECURITY DEFINER function is its only door: it lists, across organisations, the calls that have a transcript but no insights yet,
-- and are ready to try (not failed too often, not waiting for a retry, and finished at least 5 seconds ago). It returns ids only.
CREATE OR REPLACE FUNCTION worker_pending_analysis(p_limit integer)
RETURNS TABLE (call_log_id uuid, org_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.org_id
  FROM call_logs c
  JOIN call_transcripts t ON t.call_log_id = c.id
  LEFT JOIN call_insights i ON i.call_log_id = c.id
  LEFT JOIN call_analysis_attempts a ON a.call_log_id = c.id
  WHERE i.call_log_id IS NULL
    AND c.created_at < now() - interval '5 seconds'
    AND jsonb_array_length(t.segments) > 0
    AND (a.call_log_id IS NULL OR (a.attempts < 5 AND a.next_try_at <= now()))
  ORDER BY c.created_at
  LIMIT greatest(1, least(p_limit, 50))
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION worker_pending_analysis(integer) FROM PUBLIC;
