import { markPaymentPaid } from "@voiceai/db";
import { verifyFlutterwaveHash } from "@voiceai/providers";
import { flutterwaveSecretHash } from "@/lib/payments";
import { getDb } from "@/lib/server";

/** Flutterwave says a charge completed. Its secret hash must match; the amount (whole currency units) and currency must match what we asked for. */
export async function POST(req: Request) {
  if (!verifyFlutterwaveHash(req.headers.get("verif-hash"), flutterwaveSecretHash())) return Response.json({ error: "bad_signature" }, { status: 400 });
  const e = await req.json().catch(() => null);
  if (e?.event !== "charge.completed" || e.data?.status !== "successful") return Response.json({ ok: true, ignored: e?.event ?? null });
  const d = e.data;
  if (typeof d.tx_ref !== "string" || typeof d.amount !== "number") return Response.json({ error: "unexpected_shape" }, { status: 400 });
  const outcome = await markPaymentPaid(getDb(), "flutterwave", d.tx_ref, String(d.id ?? ""), Math.round(d.amount * 100), String(d.currency ?? ""));
  if (outcome !== "credited" && outcome !== "already") console.error(`flutterwave webhook ${outcome} for ${d.tx_ref}`);
  return Response.json({ ok: true, outcome });
}
