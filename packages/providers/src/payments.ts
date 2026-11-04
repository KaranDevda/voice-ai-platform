import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ProviderError } from "./types";

/**
 * Payment gateways: Razorpay (payment links) and Stripe (Checkout), plus the checks that a webhook really came from them.
 * Written from their documentation and NOT yet run against real accounts: test with each gateway's test mode before taking real money.
 * Amounts are whole paise (Rs 1 = 100 paise) everywhere.
 */

const safeEqual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** Razorpay signs the exact request body with the webhook secret (HMAC-SHA256, hex) and sends it in X-Razorpay-Signature. */
export function verifyRazorpaySignature(rawBody: string, signature: string | null | undefined, secret: string): boolean {
  if (!signature || !secret) return false;
  return safeEqual(createHmac("sha256", secret).update(rawBody).digest("hex"), signature.trim());
}

/** Stripe-Signature is "t=<unix time>,v1=<hex>[,v1=<hex>]"; v1 is HMAC-SHA256 of "<t>.<body>". Old timestamps are refused (replay). */
export function verifyStripeSignature(rawBody: string, header: string | null | undefined, secret: string, nowS = Math.floor(Date.now() / 1000), toleranceS = 300): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("=") as [string, string]);
  const t = parts.find(([k]) => k === "t")?.[1];
  if (!t || !/^\d+$/.test(t) || Math.abs(nowS - Number(t)) > toleranceS) return false;
  const want = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return parts.some(([k, v]) => k === "v1" && !!v && safeEqual(want, v));
}

/** Paystack signs the exact body with the secret key (HMAC-SHA512, hex) in X-Paystack-Signature. */
export function verifyPaystackSignature(rawBody: string, signature: string | null | undefined, secretKey: string): boolean {
  if (!signature || !secretKey) return false;
  return safeEqual(createHmac("sha512", secretKey).update(rawBody).digest("hex"), signature.trim());
}

/** Flutterwave sends the secret hash you chose in its dashboard, as is, in the verif-hash header. */
export function verifyFlutterwaveHash(header: string | null | undefined, secretHash: string): boolean {
  return !!header && !!secretHash && safeEqual(header.trim(), secretHash);
}

/**
 * Cryptomus puts a "sign" in the JSON body: md5(base64(the JSON without "sign", slashes and non-ASCII escaped the way PHP does) + API key).
 * Takes the parsed body.
 */
export function verifyCryptomusSignature(body: Record<string, unknown>, apiKey: string): boolean {
  const { sign, ...rest } = body;
  if (typeof sign !== "string" || !apiKey) return false;
  const json = JSON.stringify(rest).replace(/\//g, "\\/").replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return safeEqual(createHash("md5").update(Buffer.from(json).toString("base64") + apiKey).digest("hex"), sign.toLowerCase());
}

const major = (minor: number) => (minor / 100).toFixed(2);

export interface PaymentsConfig {
  razorpay?: { keyId: string; keySecret: string }; stripeSecretKey?: string;
  paypal?: { clientId: string; clientSecret: string; baseUrl?: string }; paystackSecretKey?: string; flutterwaveSecretKey?: string; cryptomus?: { merchantId: string; apiKey: string };
  fetch?: typeof fetch;
}

export function createPayments(config: PaymentsConfig) {
  const f = config.fetch ?? fetch;
  async function send(provider: string, url: string, init: RequestInit): Promise<Record<string, any>> {
    const res = await f(url, { ...init, signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    const json = text ? (() => { try { return JSON.parse(text); } catch { return {}; } })() : {};
    if (!res.ok) throw new ProviderError(`${provider} ${new URL(url).pathname} failed (${res.status}): ${String(json.error?.description ?? json.error?.message ?? text).slice(0, 200)}`, res.status, provider);
    return json;
  }
  async function paypalAuth() {
    if (!config.paypal) throw new ProviderError("PayPal is not set up (PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET)", 503, "paypal");
    const base = config.paypal.baseUrl ?? "https://api-m.paypal.com";
    const r = await send("paypal", `${base}/v1/oauth2/token`, { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
    if (!r.access_token) throw new ProviderError("PayPal did not give an access token", 502, "paypal");
    return { token: String(r.access_token), base };
  }
  return {
    /** A Razorpay payment link for the amount. `paymentId` (ours) is stored on it so the payment can be matched back. */
    async razorpayLink(i: { amountPaise: number; paymentId: string; description: string; callbackUrl: string }): Promise<{ id: string; url: string }> {
      if (!config.razorpay) throw new ProviderError("Razorpay is not set up (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET)", 503, "razorpay");
      const r = await send("razorpay", "https://api.razorpay.com/v1/payment_links", {
        method: "POST",
        headers: { authorization: `Basic ${Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString("base64")}`, "content-type": "application/json" },
        body: JSON.stringify({ amount: i.amountPaise, currency: "INR", accept_partial: false, description: i.description, reference_id: i.paymentId, notes: { payment_id: i.paymentId }, callback_url: i.callbackUrl, callback_method: "get" }),
      });
      if (!r.id || !r.short_url) throw new ProviderError("Razorpay did not return a payment link", 502, "razorpay");
      return { id: String(r.id), url: String(r.short_url) };
    },
    /** PayPal: an order for the amount; the person approves it on PayPal's page and comes back to returnUrl with ?token=<order id>. Then call paypalCapture. */
    async paypalOrder(i: { amountMinor: number; currency: string; paymentId: string; description: string; returnUrl: string; cancelUrl: string }): Promise<{ id: string; url: string }> {
      const auth = await paypalAuth();
      const r = await send("paypal", `${auth.base}/v2/checkout/orders`, { method: "POST", headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
        body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ reference_id: i.paymentId, custom_id: i.paymentId, description: i.description, amount: { currency_code: i.currency, value: major(i.amountMinor) } }],
          payment_source: { paypal: { experience_context: { user_action: "PAY_NOW", return_url: i.returnUrl, cancel_url: i.cancelUrl } } } }) });
      const approve = (r.links as { rel: string; href: string }[] | undefined)?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
      if (!r.id || !approve) throw new ProviderError("PayPal did not return an approval page", 502, "paypal");
      return { id: String(r.id), url: approve };
    },
    /** Takes the money for an approved PayPal order. Safe to call twice (PayPal answers with the same capture). */
    async paypalCapture(orderId: string): Promise<{ completed: boolean; captureId: string | null; amountMinor: number | null; currency: string | null }> {
      const auth = await paypalAuth();
      const r = await send("paypal", `${auth.base}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: "POST", headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json", prefer: "return=representation" }, body: "{}" });
      const cap = r.purchase_units?.[0]?.payments?.captures?.[0];
      return { completed: r.status === "COMPLETED" && cap?.status === "COMPLETED", captureId: cap?.id ?? null, amountMinor: cap?.amount?.value ? Math.round(Number(cap.amount.value) * 100) : null, currency: cap?.amount?.currency_code ?? null };
    },
    /** Asks PayPal whether a webhook is genuine (PayPal's own check), using the webhook id from its dashboard. */
    async paypalVerifyWebhook(i: { headers: Headers; rawBody: string; webhookId: string }): Promise<boolean> {
      const auth = await paypalAuth();
      const h = (k: string) => i.headers.get(k) ?? "";
      const r = await send("paypal", `${auth.base}/v1/notifications/verify-webhook-signature`, { method: "POST", headers: { authorization: `Bearer ${auth.token}`, "content-type": "application/json" },
        body: JSON.stringify({ auth_algo: h("paypal-auth-algo"), cert_url: h("paypal-cert-url"), transmission_id: h("paypal-transmission-id"), transmission_sig: h("paypal-transmission-sig"), transmission_time: h("paypal-transmission-time"), webhook_id: i.webhookId, webhook_event: JSON.parse(i.rawBody) }) });
      return r.verification_status === "SUCCESS";
    },
    /** Paystack: a payment page. `reference` is ours and comes back in the webhook. */
    async paystackInit(i: { email: string; amountMinor: number; currency: string; reference: string; callbackUrl: string }): Promise<{ id: string; url: string }> {
      if (!config.paystackSecretKey) throw new ProviderError("Paystack is not set up (PAYSTACK_SECRET_KEY)", 503, "paystack");
      const r = await send("paystack", "https://api.paystack.co/transaction/initialize", { method: "POST", headers: { authorization: `Bearer ${config.paystackSecretKey}`, "content-type": "application/json" }, body: JSON.stringify({ email: i.email, amount: i.amountMinor, currency: i.currency, reference: i.reference, callback_url: i.callbackUrl }) });
      if (!r.data?.authorization_url || !r.data?.reference) throw new ProviderError("Paystack did not return a payment page", 502, "paystack");
      return { id: String(r.data.reference), url: String(r.data.authorization_url) };
    },
    /** Flutterwave: a payment page. `txRef` is ours and comes back in the webhook. */
    async flutterwavePay(i: { email: string; amountMinor: number; currency: string; txRef: string; redirectUrl: string }): Promise<{ id: string; url: string }> {
      if (!config.flutterwaveSecretKey) throw new ProviderError("Flutterwave is not set up (FLUTTERWAVE_SECRET_KEY)", 503, "flutterwave");
      const r = await send("flutterwave", "https://api.flutterwave.com/v3/payments", { method: "POST", headers: { authorization: `Bearer ${config.flutterwaveSecretKey}`, "content-type": "application/json" }, body: JSON.stringify({ tx_ref: i.txRef, amount: major(i.amountMinor), currency: i.currency, redirect_url: i.redirectUrl, customer: { email: i.email } }) });
      if (!r.data?.link) throw new ProviderError("Flutterwave did not return a payment page", 502, "flutterwave");
      return { id: i.txRef, url: String(r.data.link) };
    },
    /** Cryptomus: a crypto payment page for a fiat amount. The webhook carries the invoice uuid, which is what we keep. */
    async cryptomusInvoice(i: { amountMinor: number; currency: string; orderId: string; callbackUrl: string; returnUrl: string }): Promise<{ id: string; url: string }> {
      if (!config.cryptomus) throw new ProviderError("Cryptomus is not set up (CRYPTOMUS_MERCHANT_ID, CRYPTOMUS_API_KEY)", 503, "cryptomus");
      const body = JSON.stringify({ amount: major(i.amountMinor), currency: i.currency, order_id: i.orderId, url_callback: i.callbackUrl, url_return: i.returnUrl });
      const sign = createHash("md5").update(Buffer.from(body).toString("base64") + config.cryptomus.apiKey).digest("hex");
      const r = await send("cryptomus", "https://api.cryptomus.com/v1/payment", { method: "POST", headers: { merchant: config.cryptomus.merchantId, sign, "content-type": "application/json" }, body });
      if (!r.result?.uuid || !r.result?.url) throw new ProviderError("Cryptomus did not return a payment page", 502, "cryptomus");
      return { id: String(r.result.uuid), url: String(r.result.url) };
    },
    /** A Stripe Checkout page for the amount in rupees. */
    async stripeCheckout(i: { amountPaise: number; paymentId: string; description: string; successUrl: string; cancelUrl: string }): Promise<{ id: string; url: string }> {
      if (!config.stripeSecretKey) throw new ProviderError("Stripe is not set up (STRIPE_SECRET_KEY)", 503, "stripe");
      const form = new URLSearchParams({
        mode: "payment", success_url: i.successUrl, cancel_url: i.cancelUrl, client_reference_id: i.paymentId, "metadata[payment_id]": i.paymentId,
        "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "inr", "line_items[0][price_data][unit_amount]": String(i.amountPaise), "line_items[0][price_data][product_data][name]": i.description,
      });
      const r = await send("stripe", "https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { authorization: `Bearer ${config.stripeSecretKey}`, "content-type": "application/x-www-form-urlencoded" }, body: form });
      if (!r.id || !r.url) throw new ProviderError("Stripe did not return a checkout page", 502, "stripe");
      return { id: String(r.id), url: String(r.url) };
    },
  };
}
