import { markPaymentPaid } from "@voiceai/db";
import { verifyRazorpaySignature } from "@voiceai/providers";
import { razorpayWebhookSecret } from "@/lib/payments";
import { getDb } from "@/lib/server";

/** Razorpay tells us a payment link was paid. The signature is checked on the exact body; the amount must match what we asked for. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyRazorpaySignature(raw, req.headers.get("x-razorpay-signature"), razorpayWebhookSecret())) return Response.json({ error: "bad_signature" }, { status: 400 });
  let e: any;
  try { e = JSON.parse(raw); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
  if (e?.event !== "payment_link.paid") return Response.json({ ok: true, ignored: e?.event ?? null });
  const ref = e.payload?.payment_link?.entity?.id, pay = e.payload?.payment?.entity;
  if (typeof ref !== "string" || typeof pay?.amount !== "number") return Response.json({ error: "unexpected_shape" }, { status: 400 });
  const outcome = await markPaymentPaid(getDb(), "razorpay", ref, typeof pay.id === "string" ? pay.id : null, pay.amount, "INR");
  if (outcome === "amount_mismatch" || outcome === "unknown") console.error(`razorpay webhook ${outcome} for ${ref}`);
  return Response.json({ ok: true, outcome });
}
