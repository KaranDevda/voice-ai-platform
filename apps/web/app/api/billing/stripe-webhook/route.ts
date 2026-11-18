import { markPaymentPaid, reversePayment } from "@voiceai/db";
import { verifyStripeSignature } from "@voiceai/providers";
import { stripeWebhookSecret } from "@/lib/payments";
import { getDb } from "@/lib/server";

/**
 * Stripe tells us a Checkout was completed (credit it), or a charge was refunded or disputed (take the credit back).
 * The signature is checked on the exact body; only a paid payment of the right amount and currency is credited.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), stripeWebhookSecret())) return Response.json({ error: "bad_signature" }, { status: 400 });
  let e: any;
  try { e = JSON.parse(raw); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
  const o = e?.data?.object;

  if (e?.type === "charge.refunded" || e?.type === "charge.dispute.created") {
    const dispute = e.type === "charge.dispute.created";
    const pi = o?.payment_intent, amount = dispute ? o?.amount : o?.amount_refunded;
    if (typeof pi !== "string" || typeof amount !== "number" || typeof o?.id !== "string") return Response.json({ ok: true, ignored: "no payment to match" });
    const outcome = await reversePayment(getDb(), "stripe", pi, amount, dispute ? "add" : "cumulative", o.id);
    if (outcome === "unknown") console.error(`stripe ${e.type} for a payment we do not know (${pi})`);
    return Response.json({ ok: true, outcome });
  }

  if (e?.type !== "checkout.session.completed" && e?.type !== "checkout.session.async_payment_succeeded") return Response.json({ ok: true, ignored: e?.type ?? null });
  if (typeof o?.id !== "string" || o.payment_status !== "paid" || typeof o.currency !== "string" || typeof o.amount_total !== "number") return Response.json({ ok: true, ignored: "not a paid payment" });
  const outcome = await markPaymentPaid(getDb(), "stripe", o.id, typeof o.payment_intent === "string" ? o.payment_intent : null, o.amount_total, o.currency.toUpperCase());
  if (outcome === "amount_mismatch" || outcome === "currency_mismatch" || outcome === "unknown") console.error(`stripe webhook ${outcome} for ${o.id}`);
  return Response.json({ ok: true, outcome });
}
