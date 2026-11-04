-- What the carrier costs the platform, in paise: one row of settings for the whole platform (not organisation data).
CREATE TABLE "platform_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"cost_call_per_min_paise" integer DEFAULT 0 NOT NULL,
	"cost_sms_paise" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_settings_one_row" CHECK ("id" = 1),
	CONSTRAINT "platform_settings_costs_chk" CHECK ("cost_call_per_min_paise" BETWEEN 0 AND 100000 AND "cost_sms_paise" BETWEEN 0 AND 100000)
);--> statement-breakpoint
INSERT INTO "platform_settings" ("id") VALUES (1);--> statement-breakpoint
-- Usage charged to customers, one row per organisation, day (India time), kind and number dialled, for the last p_days days.
-- "units" are started minutes for calls and texts for SMS. For platform staff only (call after checking "platform.admin").
CREATE OR REPLACE FUNCTION platform_usage_rows(p_days integer DEFAULT 30, p_limit integer DEFAULT 20000)
RETURNS TABLE (org_id uuid, org_name text, day date, kind text, amount_paise bigint, units bigint, phone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.org_id, o.name, (l.created_at AT TIME ZONE 'Asia/Kolkata')::date,
         CASE l.reason WHEN 'usage_call' THEN 'call' ELSE 'sms' END,
         sum(-l.delta_paise)::bigint,
         CASE WHEN l.reason = 'usage_call' THEN sum(ceil(coalesce(c.duration_s, 0) / 60.0))::bigint ELSE count(*)::bigint END,
         coalesce(CASE WHEN l.reason = 'usage_call' THEN lc.phone_e164 ELSE ls.phone_e164 END, '')
    FROM credit_ledger l
    JOIN organizations o ON o.id = l.org_id
    LEFT JOIN call_logs c ON l.reason = 'usage_call' AND c.id::text = l.ref
    LEFT JOIN leads lc ON lc.id = c.lead_id
    LEFT JOIN sms_messages m ON l.reason = 'usage_sms' AND m.id::text = l.ref
    LEFT JOIN leads ls ON ls.id = m.lead_id
   WHERE l.reason IN ('usage_call', 'usage_sms') AND l.created_at >= now() - make_interval(days => greatest(1, least(p_days, 366)))
   GROUP BY 1, 2, 3, 4, 7, l.reason
   LIMIT greatest(1, least(p_limit, 50000))
$$;--> statement-breakpoint
-- Money in (paid top-ups in the period) and what each organisation has left.
CREATE OR REPLACE FUNCTION platform_money(p_days integer DEFAULT 30)
RETURNS TABLE (org_id uuid, org_name text, topups_paise bigint, balance_paise bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.name,
         coalesce((SELECT sum(p.amount_paise) FROM payments p WHERE p.org_id = o.id AND p.status = 'paid' AND p.paid_at >= now() - make_interval(days => greatest(1, least(p_days, 366)))), 0)::bigint,
         coalesce((SELECT sum(l.delta_paise) FROM credit_ledger l WHERE l.org_id = o.id), 0)::bigint
    FROM organizations o ORDER BY o.name
$$;
