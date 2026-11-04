import { markPaymentPaid } from "@voiceai/db";
import { verifyPaystackSignature } from "@voiceai/providers";
import { paystackSecretKey } from "@/lib/payments";
import { getDb } from "@/lib/server";

/** Paystack says a charge succeeded. Signature checked on the exact body; amount and currency must match what we asked for. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyPaystackSignature(raw, req.headers.get("x-paystack-signature"), paystackSecretKey())) return Response.json({ error: "bad_signature" }, { status: 400 });
  let e: any;
  try { e = JSON.parse(raw); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
  if (e?.event !== "charge.success" || e.data?.status !== "success") return Response.json({ ok: true, ignored: e?.event ?? null });
  const d = e.data;
  if (typeof d.reference !== "string" || typeof d.amount !== "number") return Response.json({ error: "unexpected_shape" }, { status: 400 });
  const outcome = await markPaymentPaid(getDb(), "paystack", d.reference, String(d.id ?? ""), d.amount, String(d.currency ?? ""));
  if (outcome !== "credited" && outcome !== "already") console.error(`paystack webhook ${outcome} for ${d.reference}`);
  return Response.json({ ok: true, outcome });
}
