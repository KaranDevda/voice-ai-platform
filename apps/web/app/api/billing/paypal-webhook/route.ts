import { markPaymentPaid } from "@voiceai/db";
import { paymentGateways, paypalWebhookId } from "@/lib/payments";
import { getDb } from "@/lib/server";

/** PayPal says a capture completed (a backup to the return page). PayPal itself is asked whether the message is genuine. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!paypalWebhookId()) return Response.json({ error: "not_configured" }, { status: 503 });
  let ok = false;
  try { ok = await paymentGateways().paypalVerifyWebhook({ headers: req.headers, rawBody: raw, webhookId: paypalWebhookId() }); } catch { return Response.json({ error: "verify_failed" }, { status: 502 }); }
  if (!ok) return Response.json({ error: "bad_signature" }, { status: 400 });
  const e = JSON.parse(raw);
  if (e?.event_type !== "PAYMENT.CAPTURE.COMPLETED") return Response.json({ ok: true, ignored: e?.event_type ?? null });
  const r = e.resource, order = r?.supplementary_data?.related_ids?.order_id;
  if (typeof order !== "string" || !r?.amount?.value) return Response.json({ error: "unexpected_shape" }, { status: 400 });
  const outcome = await markPaymentPaid(getDb(), "paypal", order, String(r.id ?? ""), Math.round(Number(r.amount.value) * 100), String(r.amount.currency_code ?? ""));
  if (outcome !== "credited" && outcome !== "already") console.error(`paypal webhook ${outcome} for ${order}`);
  return Response.json({ ok: true, outcome });
}
