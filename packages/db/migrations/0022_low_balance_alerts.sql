-- Low-balance alerts: when an organisation with billing on falls under the amount it set in Settings, its admins get one e-mail. Another is
-- sent only after the organisation has added credit again and dropped under the limit again (so nobody is e-mailed every few minutes).
CREATE TABLE "low_balance_alerts" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "low_balance_alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "low_balance_alerts" ADD CONSTRAINT "low_balance_alerts_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
-- The e-mail worker has no organisation context, so it asks through these two functions. Run by ONE worker.
CREATE FUNCTION worker_low_balance_due(p_limit integer DEFAULT 20)
RETURNS TABLE (org_id uuid, org_name text, balance_paise bigint, threshold_paise bigint, emails text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.name, b.bal, (o.settings_json->'billing'->>'lowBalancePaise')::bigint,
         coalesce((SELECT array_agg(DISTINCT u.email) FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
                    WHERE u.org_id = o.id AND u.status = 'active' AND r.key IN ('org_admin', 'super_admin')), '{}')
    FROM organizations o
    CROSS JOIN LATERAL (SELECT coalesce(sum(l.delta_paise), 0)::bigint AS bal FROM credit_ledger l WHERE l.org_id = o.id) b
    LEFT JOIN low_balance_alerts a ON a.org_id = o.id
   WHERE (o.settings_json->'billing'->>'enabled') = 'true'
     AND coalesce((o.settings_json->'billing'->>'lowBalancePaise')::bigint, 0) > 0
     AND b.bal < (o.settings_json->'billing'->>'lowBalancePaise')::bigint
     AND (a.sent_at IS NULL OR a.sent_at < coalesce((SELECT max(l.created_at) FROM credit_ledger l WHERE l.org_id = o.id AND l.delta_paise > 0), 'epoch'))
   LIMIT greatest(1, least(p_limit, 100))
$$;--> statement-breakpoint
CREATE FUNCTION worker_low_balance_sent(p_org uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO low_balance_alerts (org_id, sent_at) VALUES (p_org, now()) ON CONFLICT (org_id) DO UPDATE SET sent_at = now()
$$;
