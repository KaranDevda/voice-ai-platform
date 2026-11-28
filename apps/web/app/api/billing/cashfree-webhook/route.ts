import { markPaymentPaid, reversePayment } from "@voiceai/db";
import { verifyCashfreeSignature } from "@voiceai/providers";
import { cashfreeSecretKey, paymentGateways } from "@/lib/payments";
import { getDb } from "@/lib/server";

/**
 * Cashfree tells us a payment succeeded (credit it) or a refund went through (take the credit back). The signature is checked on the exact body
 * and timestamp, and before crediting we ask Cashfree itself whether the order is really paid. The amount must match what we asked for.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyCashfreeSignature(raw, req.headers.get("x-webhook-signature"), req.headers.get("x-webhook-timestamp"), cashfreeSecretKey())) return Response.json({ error: "bad_signature" }, { status: 400 });
  let e: any;
  try { e = JSON.parse(raw); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }

  if (e?.type === "REFUND_STATUS_WEBHOOK") {
    const refund = e.data?.refund, orderId = e.data?.order?.order_id ?? refund?.order_id;
    if (refund?.refund_status !== "SUCCESS" || typeof refund?.cf_payment_id !== "string" && typeof refund?.cf_payment_id !== "number" || typeof refund?.refund_amount !== "number") return Response.json({ ok: true, ignored: "refund not completed" });
    const outcome = await reversePayment(getDb(), "cashfree", String(refund.cf_payment_id), Math.round(refund.refund_amount * 100), "add", String(refund.cf_refund_id ?? `${orderId}:${refund.refund_amount}`));
    if (outcome === "unknown") console.error(`cashfree refund for a payment we do not know (${refund.cf_payment_id})`);
    return Response.json({ ok: true, outcome });
  }

  if (e?.type !== "PAYMENT_SUCCESS_WEBHOOK") return Response.json({ ok: true, ignored: e?.type ?? null });
  const orderId = e.data?.order?.order_id, pay = e.data?.payment;
  if (typeof orderId !== "string" || pay?.payment_status !== "SUCCESS" || typeof pay?.payment_amount !== "number") return Response.json({ ok: true, ignored: "not a paid payment" });
  // Belt and braces: the notice is signed, but the credit only happens if Cashfree also says this order is paid.
  const status = await paymentGateways().cashfreeOrderStatus(orderId).catch(() => null);
  if (!status?.paid) return Response.json({ error: "not_confirmed" }, { status: 503 }); // Cashfree retries
  const outcome = await markPaymentPaid(getDb(), "cashfree", orderId, pay.cf_payment_id != null ? String(pay.cf_payment_id) : null, Math.round(pay.payment_amount * 100), String(pay.payment_currency ?? "INR").toUpperCase());
  if (outcome === "amount_mismatch" || outcome === "currency_mismatch" || outcome === "unknown") console.error(`cashfree webhook ${outcome} for ${orderId}`);
  return Response.json({ ok: true, outcome });
}
