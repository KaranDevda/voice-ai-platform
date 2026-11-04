CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"delta_paise" bigint NOT NULL,
	"reason" text NOT NULL,
	"ref" text,
	"idempotency_key" text,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_ledger_reason_chk" CHECK ("reason" IN ('topup','usage_call','usage_sms','adjustment','refund'))
);--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"gateway" text NOT NULL,
	"gateway_ref" text,
	"amount_paise" bigint NOT NULL,
	"status" text DEFAULT 'created' NOT NULL,
	"gateway_payment_id" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "payments_gateway_chk" CHECK ("gateway" IN ('razorpay','stripe')),
	CONSTRAINT "payments_status_chk" CHECK ("status" IN ('created','paid','failed')),
	CONSTRAINT "payments_amount_chk" CHECK ("amount_paise" BETWEEN 100 AND 10000000)
);--> statement-breakpoint
ALTER TABLE "credit_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_idem_uq" ON "credit_ledger" USING btree ("idempotency_key") WHERE "idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "credit_ledger_org_created_idx" ON "credit_ledger" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_gateway_ref_uq" ON "payments" USING btree ("gateway","gateway_ref") WHERE "gateway_ref" IS NOT NULL;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "credit_ledger" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "org_isolation" ON "payments" AS PERMISSIVE FOR ALL TO public USING (org_id = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK (org_id = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- A gateway told us a payment succeeded. No organisation is known yet (only the gateway's reference), so this runs outside RLS. It credits
-- the organisation ONCE (a repeated webhook changes nothing) and only when the amount paid equals the amount we asked for.
CREATE OR REPLACE FUNCTION payment_mark_paid(p_gateway text, p_ref text, p_payment_id text, p_amount bigint) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r payments%ROWTYPE;
BEGIN
  SELECT * INTO r FROM payments WHERE gateway = p_gateway AND gateway_ref = p_ref FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  IF r.status = 'paid' THEN RETURN 'already'; END IF;
  IF p_amount IS NULL OR p_amount <> r.amount_paise THEN RETURN 'amount_mismatch'; END IF;
  UPDATE payments SET status = 'paid', gateway_payment_id = p_payment_id, paid_at = now() WHERE id = r.id;
  INSERT INTO credit_ledger (org_id, delta_paise, reason, ref, idempotency_key, created_by)
    VALUES (r.org_id, r.amount_paise, 'topup', r.id::text, 'payment:' || r.id::text, r.created_by) ON CONFLICT DO NOTHING;
  RETURN 'credited';
END $$;--> statement-breakpoint
-- A sent text is charged to the organisation, when it has billing switched on and a price per text (organisation settings, in paise).
CREATE OR REPLACE FUNCTION worker_sms_done(p_id uuid, p_ok boolean, p_provider_uuid text DEFAULT NULL, p_error text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m sms_messages%ROWTYPE; v_price bigint;
BEGIN
  UPDATE sms_messages SET status = CASE WHEN p_ok THEN 'sent' ELSE 'failed' END, provider_uuid = p_provider_uuid, error = left(p_error, 300), sent_at = CASE WHEN p_ok THEN now() END
   WHERE id = p_id AND status = 'sending' RETURNING * INTO m;
  IF p_ok AND m.id IS NOT NULL THEN
    SELECT CASE WHEN coalesce((o.settings_json->'billing'->>'enabled')::boolean, false) THEN coalesce((o.settings_json->'billing'->>'smsPaise')::bigint, 0) ELSE 0 END INTO v_price FROM organizations o WHERE o.id = m.org_id;
    IF coalesce(v_price, 0) > 0 THEN
      INSERT INTO credit_ledger (org_id, delta_paise, reason, ref, idempotency_key) VALUES (m.org_id, -v_price, 'usage_sms', m.id::text, 'sms:' || m.id::text) ON CONFLICT DO NOTHING;
    END IF;
  END IF;
END $$;
