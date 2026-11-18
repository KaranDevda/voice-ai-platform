-- A gateway refund or chargeback takes credit back. p_mode 'cumulative': p_amount is the total refunded so far (Stripe's amount_refunded), so a
-- repeated or growing notice only takes back the difference. 'add': p_amount is one more amount to take back (a dispute). Either way the total
-- taken back never exceeds what the payment credited, and one event is applied once (a repeated dispute has the same key; a refund's key includes the new total, so only growth counts). Credit is returned in rupees at the payment's own rate.
CREATE FUNCTION payment_reverse(p_gateway text, p_payment_ref text, p_amount bigint, p_mode text, p_key text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r payments%ROWTYPE; v_total numeric; v_already bigint; v_delta bigint;
BEGIN
  SELECT * INTO r FROM payments WHERE gateway = p_gateway AND gateway_payment_id = p_payment_ref AND status = 'paid' FOR UPDATE;
  IF NOT FOUND THEN RETURN 'unknown'; END IF;
  v_total := coalesce(r.amount_minor, r.amount_paise);
  IF p_amount IS NULL OR p_amount <= 0 OR v_total <= 0 THEN RETURN 'unknown'; END IF;
  SELECT coalesce(sum(-delta_paise), 0) INTO v_already FROM credit_ledger WHERE org_id = r.org_id AND reason = 'refund' AND idempotency_key LIKE 'reverse:' || r.id::text || ':%';
  IF p_mode = 'cumulative' THEN v_delta := round(r.amount_paise * least(p_amount, v_total) / v_total) - v_already;
  ELSE v_delta := least(round(r.amount_paise * least(p_amount, v_total) / v_total), r.amount_paise - v_already); END IF;
  IF v_delta <= 0 THEN RETURN 'already'; END IF;
  INSERT INTO credit_ledger (org_id, delta_paise, reason, ref, idempotency_key, note)
    VALUES (r.org_id, -v_delta, 'refund', r.id::text, 'reverse:' || r.id::text || ':' || p_key || CASE WHEN p_mode = 'cumulative' THEN ':' || (v_already + v_delta)::text ELSE '' END, left('Taken back by ' || p_gateway || ' (' || p_key || ')', 300)) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN 'already'; END IF;
  RETURN 'reversed';
END $$;
