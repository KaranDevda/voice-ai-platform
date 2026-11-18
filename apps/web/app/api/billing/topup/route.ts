import { z } from "zod";
import { attachGatewayRef, failTopup, startTopup, userEmail } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { appUrl, paymentGateways } from "@/lib/payments";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({ gateway: z.enum(["razorpay", "stripe", "paypal", "paystack", "flutterwave", "cryptomus"]), amount: z.number().positive().max(10_000_000), currency: z.string().length(3).default("INR") });

/** Starts adding credit: returns the gateway's payment page. The credit arrives when the gateway's webhook confirms the payment, not here. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  let paymentId = "";
  try {
    const b = body.parse(await req.json().catch(() => null));
    const currency = b.currency.toUpperCase(), amountMinor = Math.round(b.amount * 100);
    const started = await startTopup(getDb(), user, { gateway: b.gateway, currency, amountMinor });
    paymentId = started.id;
    const base = appUrl(req), back = `${base}/billing`, g = paymentGateways(), description = "Voice AI credit";
    const email = (await userEmail(getDb(), user)) ?? "billing@example.com";
    const made =
      b.gateway === "razorpay" ? await g.razorpayLink({ amountPaise: amountMinor, paymentId, description, callbackUrl: `${back}?paid=1` })
      : b.gateway === "stripe" ? await g.stripeCheckout({ amountMinor, currency, paymentId, description, successUrl: `${back}?paid=1`, cancelUrl: `${back}?cancelled=1` })
      : b.gateway === "paypal" ? await g.paypalOrder({ amountMinor, currency, paymentId, description, returnUrl: `${base}/api/billing/paypal-return`, cancelUrl: `${back}?cancelled=1` })
      : b.gateway === "paystack" ? await g.paystackInit({ email, amountMinor, currency, reference: paymentId, callbackUrl: `${back}?paid=1` })
      : b.gateway === "flutterwave" ? await g.flutterwavePay({ email, amountMinor, currency, txRef: paymentId, redirectUrl: `${base}/api/billing/flutterwave-return` })
      : await g.cryptomusInvoice({ amountMinor, currency, orderId: paymentId, callbackUrl: `${base}/api/billing/cryptomus-webhook`, returnUrl: `${back}?paid=1` });
    await attachGatewayRef(getDb(), user, paymentId, made.id);
    return Response.json({ url: made.url, creditPaise: started.amountPaise });
  } catch (err) {
    if (paymentId) await failTopup(getDb(), user, paymentId).catch(() => {});
    return toResponse(err);
  }
}
