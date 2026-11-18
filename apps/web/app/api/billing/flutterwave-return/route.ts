import { markPaymentPaid } from "@voiceai/db";
import { appUrl, paymentGateways } from "@/lib/payments";
import { getDb } from "@/lib/server";

/**
 * Flutterwave sends the person back here with ?status=...&tx_ref=...&transaction_id=.... We never trust those: we ask Flutterwave what happened
 * to that transaction, then credit it once (the webhook may also arrive; crediting is idempotent, so whichever comes first wins).
 */
export async function GET(req: Request) {
  const back = `${appUrl(req)}/billing`, q = new URL(req.url).searchParams;
  const id = q.get("transaction_id") ?? "", ref = q.get("tx_ref") ?? "";
  if (q.get("status") === "cancelled") return Response.redirect(`${back}?cancelled=1`, 303);
  if (!/^\d{1,20}$/.test(id)) return Response.redirect(`${back}?failed=1`, 303);
  try {
    const v = await paymentGateways().flutterwaveVerify(id);
    if (!v.successful || !v.txRef || (ref && ref !== v.txRef)) return Response.redirect(`${back}?failed=1`, 303);
    const outcome = await markPaymentPaid(getDb(), "flutterwave", v.txRef, v.id, v.amountMinor, v.currency);
    if (outcome !== "credited" && outcome !== "already") console.error(`flutterwave return ${outcome} for ${v.txRef}`);
    return Response.redirect(`${back}?paid=1`, 303);
  } catch (e) {
    console.error("flutterwave verify failed:", e instanceof Error ? e.message : e);
    return Response.redirect(`${back}?failed=1`, 303);
  }
}
