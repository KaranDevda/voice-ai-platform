import { markPaymentPaid } from "@voiceai/db";
import { appUrl, paymentGateways } from "@/lib/payments";
import { getDb } from "@/lib/server";

/** PayPal sends the person back here after they approve. We take the money (only for an order we made), then credit it once. */
export async function GET(req: Request) {
  const back = `${appUrl(req)}/billing`;
  const order = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(order)) return Response.redirect(`${back}?failed=1`, 303);
  try {
    const cap = await paymentGateways().paypalCapture(order);
    if (!cap.completed) return Response.redirect(`${back}?failed=1`, 303);
    const outcome = await markPaymentPaid(getDb(), "paypal", order, cap.captureId, cap.amountMinor, cap.currency);
    if (outcome === "amount_mismatch" || outcome === "currency_mismatch" || outcome === "unknown") console.error(`paypal return ${outcome} for ${order}`);
    return Response.redirect(`${back}?paid=1`, 303);
  } catch (e) {
    console.error("paypal capture failed:", e instanceof Error ? e.message : e);
    return Response.redirect(`${back}?failed=1`, 303);
  }
}
