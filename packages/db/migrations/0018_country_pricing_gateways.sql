-- Dialling codes, so a number's country is worked out in one place (the database) for charging, prices and reports. +1 is treated as US.
CREATE TABLE "calling_codes" ("code" text PRIMARY KEY NOT NULL, "country" text NOT NULL);--> statement-breakpoint
INSERT INTO "calling_codes" ("code", "country") VALUES
 ('91','IN'),('1','US'),('44','GB'),('971','AE'),('65','SG'),('61','AU'),('49','DE'),('33','FR'),('39','IT'),('34','ES'),('81','JP'),('86','CN'),('852','HK'),
 ('92','PK'),('880','BD'),('94','LK'),('977','NP'),('966','SA'),('974','QA'),('968','OM'),('965','KW'),('973','BH'),('27','ZA'),('234','NG'),('254','KE'),('233','GH'),
 ('20','EG'),('55','BR'),('52','MX'),('7','RU'),('60','MY'),('62','ID'),('63','PH'),('66','TH'),('84','VN'),('82','KR'),('64','NZ'),('353','IE'),('31','NL'),('46','SE'),
 ('47','NO'),('45','DK'),('41','CH'),('90','TR'),('255','TZ'),('256','UG'),('251','ET'),('212','MA'),('213','DZ'),('98','IR'),('964','IQ'),('972','IL'),('961','LB'),('975','BT'),('960','MV');--> statement-breakpoint
CREATE OR REPLACE FUNCTION phone_country(p text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT c.country FROM calling_codes c WHERE p LIKE '+' || c.code || '%' ORDER BY length(c.code) DESC LIMIT 1), 'other')
$$;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN "country" text;--> statement-breakpoint
UPDATE credit_ledger l SET country = coalesce((SELECT phone_country(ld.phone_e164) FROM call_logs c JOIN leads ld ON ld.id = c.lead_id WHERE c.id::text = l.ref), 'other') WHERE l.reason = 'usage_call';--> statement-breakpoint
UPDATE credit_ledger l SET country = coalesce((SELECT phone_country(ld.phone_e164) FROM sms_messages m JOIN leads ld ON ld.id = m.lead_id WHERE m.id::text = l.ref), 'other') WHERE l.reason = 'usage_sms';--> statement-breakpoint
-- An organisation's price for one country; where there is none, the organisation's standard price (Settings) applies.
CREATE TABLE "country_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"country" text NOT NULL,
	"call_per_min_paise" integer NOT NULL,
	"sms_paise" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "country_rates_country_chk" CHECK ("country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "country_rates_price_chk" CHECK ("call_per_min_paise" BETWEEN 0 AND 100000 AND "sms_paise" BETWEEN 0 AND 100000)
);--> statement-breakpoint
ALTER TABLE "country_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "country_rates" ADD CONSTRAINT "country_rates_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
CREATE UNIQUE INDEX "country_rates_org_country_uq" ON "country_rates" USING btree ("org_id","country");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "country_rates" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- The price (paise) an organisation is charged for one call minute ('call') or one text ('sms') to a country.
CREATE OR REPLACE FUNCTION org_rate(p_org uuid, p_country text, p_kind text) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    (SELECT CASE p_kind WHEN 'call' THEN r.call_per_min_paise ELSE r.sms_paise END FROM country_rates r WHERE r.org_id = p_org AND r.country = p_country),
    (SELECT CASE p_kind WHEN 'call' THEN (o.settings_json->'billing'->>'callPerMinPaise')::bigint ELSE (o.settings_json->'billing'->>'smsPaise')::bigint END FROM organizations o WHERE o.id = p_org),
    0)
$$;--> statement-breakpoint
-- Texts are charged at the price for the number's country.
CREATE OR REPLACE FUNCTION worker_sms_done(p_id uuid, p_ok boolean, p_provider_uuid text DEFAULT NULL, p_error text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m sms_messages%ROWTYPE; v_price bigint; v_country text; v_on boolean;
BEGIN
  UPDATE sms_messages SET status = CASE WHEN p_ok THEN 'sent' ELSE 'failed' END, provider_uuid = p_provider_uuid, error = left(p_error, 300), sent_at = CASE WHEN p_ok THEN now() END
   WHERE id = p_id AND status = 'sending' RETURNING * INTO m;
  IF p_ok AND m.id IS NOT NULL THEN
    SELECT coalesce((o.settings_json->'billing'->>'enabled')::boolean, false) INTO v_on FROM organizations o WHERE o.id = m.org_id;
    IF v_on THEN
      SELECT phone_country(l.phone_e164) INTO v_country FROM leads l WHERE l.id = m.lead_id;
      v_price := org_rate(m.org_id, coalesce(v_country, 'other'), 'sms');
      IF coalesce(v_price, 0) > 0 THEN
        INSERT INTO credit_ledger (org_id, delta_paise, reason, ref, idempotency_key, country) VALUES (m.org_id, -v_price, 'usage_sms', m.id::text, 'sms:' || m.id::text, coalesce(v_country, 'other')) ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;
END $$;--> statement-breakpoint
-- More gateways, in other currencies. A payment is asked for in the gateway's currency (amount_minor, e.g. cents) and credited in rupees
-- at the exchange rate fixed when it started (amount_paise).
ALTER TABLE "payments" ADD COLUMN "currency" text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "amount_minor" bigint;--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_gateway_chk";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_gateway_chk" CHECK ("gateway" IN ('razorpay','stripe','paypal','paystack','flutterwave','cryptomus'));--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"currency" text PRIMARY KEY NOT NULL,
	"paise_per_unit" numeric(18,6) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rates_currency_chk" CHECK ("currency" ~ '^[A-Z]{3}$' AND "currency" <> 'INR'),
	CONSTRAINT "exchange_rates_rate_chk" CHECK ("paise_per_unit" > 0)
);--> statement-breakpoint
DROP FUNCTION IF EXISTS payment_mark_paid(text, text, text, bigint);--> statement-breakpoint
CREATE FUNCTION payment_mark_paid(p_gateway text, p_ref text, p_payment_id text, p_amount bigint, p_currency text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r payments%ROWTYPE;
BEGIN
  SELECT * INTO r FROM payments WHERE gateway = p_gateway AND gateway_ref = p_ref FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  IF r.status = 'paid' THEN RETURN 'already'; END IF;
  IF p_amount IS NULL OR p_amount <> coalesce(r.amount_minor, r.amount_paise) THEN RETURN 'amount_mismatch'; END IF;
  IF p_currency IS NOT NULL AND upper(p_currency) <> r.currency THEN RETURN 'currency_mismatch'; END IF;
  UPDATE payments SET status = 'paid', gateway_payment_id = p_payment_id, paid_at = now() WHERE id = r.id;
  INSERT INTO credit_ledger (org_id, delta_paise, reason, ref, idempotency_key, created_by)
    VALUES (r.org_id, r.amount_paise, 'topup', r.id::text, 'payment:' || r.id::text, r.created_by) ON CONFLICT DO NOTHING;
  RETURN 'credited';
END $$;--> statement-breakpoint
-- The usage report, already added up by organisation, day, kind and country (a few rows however much was used).
DROP FUNCTION IF EXISTS platform_usage_rows(integer, integer);--> statement-breakpoint
CREATE FUNCTION platform_usage_rows(p_days integer DEFAULT 30)
RETURNS TABLE (org_id uuid, org_name text, day date, kind text, country text, amount_paise bigint, units bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.org_id, o.name, (l.created_at AT TIME ZONE 'Asia/Kolkata')::date,
         CASE l.reason WHEN 'usage_call' THEN 'call' ELSE 'sms' END, coalesce(l.country, 'other'),
         sum(-l.delta_paise)::bigint,
         CASE WHEN l.reason = 'usage_call' THEN sum(ceil(coalesce(c.duration_s, 0) / 60.0))::bigint ELSE count(*)::bigint END
    FROM credit_ledger l
    JOIN organizations o ON o.id = l.org_id
    LEFT JOIN call_logs c ON l.reason = 'usage_call' AND c.id::text = l.ref
   WHERE l.reason IN ('usage_call', 'usage_sms') AND l.created_at >= now() - make_interval(days => greatest(1, least(p_days, 366)))
   GROUP BY 1, 2, 3, 4, 5, l.reason
$$;
