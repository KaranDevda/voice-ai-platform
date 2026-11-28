import { markPaymentPaid } from "@voiceai/db";
import { appUrl, paymentGateways } from "@/lib/payments";
import { getDb } from "@/lib/server";

/**
 * Cashfree sends the person back here with ?order_id=... after the payment page. We never trust the redirect: we ask Cashfree whether that order
 * is paid, then credit it once (the webhook may also arrive; crediting is idempotent, so whichever comes first wins). This is why the balance
 * rises even when the webhook is late or cannot reach this machine.
 */
export async function GET(req: Request) {
  const back = `${appUrl(req)}/billing`, orderId = new URL(req.url).searchParams.get("order_id") ?? "";
  if (!/^[A-Za-z0-9_-]{1,60}$/.test(orderId)) return Response.redirect(`${back}?failed=1`, 303);
  try {
    const s = await paymentGateways().cashfreeOrderStatus(orderId);
    if (!s.paid || s.amountMinor == null) return Response.redirect(`${back}?failed=1`, 303);
    const outcome = await markPaymentPaid(getDb(), "cashfree", orderId, null, s.amountMinor, (s.currency ?? "INR").toUpperCase());
    if (outcome !== "credited" && outcome !== "already") console.error(`cashfree return ${outcome} for ${orderId}`);
    return Response.redirect(`${back}?paid=1`, 303);
  } catch (e) {
    console.error("cashfree verify failed:", e instanceof Error ? e.message : e);
    return Response.redirect(`${back}?failed=1`, 303);
  }
}
