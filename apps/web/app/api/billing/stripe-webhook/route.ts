import { markPaymentPaid } from "@voiceai/db";
import { verifyStripeSignature } from "@voiceai/providers";
import { stripeWebhookSecret } from "@/lib/payments";
import { getDb } from "@/lib/server";

/** Stripe tells us a Checkout was completed. The signature is checked on the exact body; only a paid, rupee payment of the right amount is credited. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), stripeWebhookSecret())) return Response.json({ error: "bad_signature" }, { status: 400 });
  let e: any;
  try { e = JSON.parse(raw); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
  if (e?.type !== "checkout.session.completed" && e?.type !== "checkout.session.async_payment_succeeded") return Response.json({ ok: true, ignored: e?.type ?? null });
  const s = e.data?.object;
  if (typeof s?.id !== "string" || s.payment_status !== "paid" || s.currency !== "inr" || typeof s.amount_total !== "number") return Response.json({ ok: true, ignored: "not a paid rupee payment" });
  const outcome = await markPaymentPaid(getDb(), "stripe", s.id, typeof s.payment_intent === "string" ? s.payment_intent : null, s.amount_total, "INR");
  if (outcome === "amount_mismatch" || outcome === "unknown") console.error(`stripe webhook ${outcome} for ${s.id}`);
  return Response.json({ ok: true, outcome });
}
