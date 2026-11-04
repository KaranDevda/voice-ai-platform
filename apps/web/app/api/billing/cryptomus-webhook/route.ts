import { markPaymentPaid } from "@voiceai/db";
import { verifyCryptomusSignature } from "@voiceai/providers";
import { cryptomusApiKey } from "@/lib/payments";
import { getDb } from "@/lib/server";

/** Cryptomus says an invoice was paid. The signature in the body is checked; only "paid" counts, for the invoice amount and currency. */
export async function POST(req: Request) {
  const e = await req.json().catch(() => null) as Record<string, any> | null;
  if (!e || !verifyCryptomusSignature(e, cryptomusApiKey())) return Response.json({ error: "bad_signature" }, { status: 400 });
  if (e.status !== "paid" && e.status !== "paid_over") return Response.json({ ok: true, ignored: e.status ?? null });
  if (typeof e.uuid !== "string" || !e.amount) return Response.json({ error: "unexpected_shape" }, { status: 400 });
  const outcome = await markPaymentPaid(getDb(), "cryptomus", e.uuid, String(e.txid ?? ""), Math.round(Number(e.amount) * 100), String(e.currency ?? ""));
  if (outcome !== "credited" && outcome !== "already") console.error(`cryptomus webhook ${outcome} for ${e.uuid}`);
  return Response.json({ ok: true, outcome });
}
