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

/**
 * Cashfree signs "<x-webhook-timestamp><raw body>" with the Payment Gateway secret key (HMAC-SHA256, base64) and sends it in x-webhook-signature.
 * Old timestamps are refused (replay).
 */
export function verifyCashfreeSignature(rawBody: string, signature: string | null | undefined, timestamp: string | null | undefined, secret: string, nowS = Math.floor(Date.now() / 1000), toleranceS = 600): boolean {
  if (!signature || !timestamp || !secret) return false;
  const t = Number(timestamp);
  if (!Number.isFinite(t)) return false;
  // Cashfree sends the time in milliseconds; accept seconds too.
  const ts = t > 1e12 ? t / 1000 : t;
  if (Math.abs(nowS - ts) > toleranceS) return false;
  return safeEqual(createHmac("sha256", secret).update(`${timestamp}${rawBody}`).digest("base64"), signature.trim());
}

const major = (minor: number) => (minor / 100).toFixed(2);

export interface PaymentsConfig {
  razorpay?: { keyId: string; keySecret: string }; stripeSecretKey?: string;
  cashfree?: { appId: string; secretKey: string; env?: "sandbox" | "production" };
  paypal?: { clientId: string; clientSecret: string; baseUrl?: string }; paystackSecretKey?: string; flutterwaveSecretKey?: string; cryptomus?: { merchantId: string; apiKey: string };
  fetch?: typeof fetch;
}

const CASHFREE_API_VERSION = "2023-08-01";
const cashfreeBase = (env: "sandbox" | "production") => (env === "production" ? "https://api.cashfree.com/pg" : "https://sandbox.cashfree.com/pg");
const cashfreeHeaders = (c: { appId: string; secretKey: string }) => ({ "x-client-id": c.appId, "x-client-secret": c.secretKey, "x-api-version": CASHFREE_API_VERSION, "content-type": "application/json" });

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
    /**
     * Asks Flutterwave (with our secret key) what really happened to a transaction, by the id it put on the redirect back.
     * Used when the person returns, so a payment is credited even if the webhook is late or never arrives. Amounts are what Flutterwave says, not the redirect's.
     */
    async flutterwaveVerify(transactionId: string): Promise<{ successful: boolean; txRef: string | null; amountMinor: number | null; currency: string | null; id: string }> {
      if (!config.flutterwaveSecretKey) throw new ProviderError("Flutterwave is not set up (FLUTTERWAVE_SECRET_KEY)", 503, "flutterwave");
      const r = await send("flutterwave", `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`, { method: "GET", headers: { authorization: `Bearer ${config.flutterwaveSecretKey}` } });
      const d = r.data ?? {};
      return { successful: r.status === "success" && d.status === "successful", txRef: typeof d.tx_ref === "string" ? d.tx_ref : null, amountMinor: typeof d.amount === "number" ? Math.round(d.amount * 100) : null, currency: typeof d.currency === "string" ? d.currency : null, id: String(d.id ?? transactionId) };
    },
    /**
     * Cashfree (UPI, cards, netbanking, wallets; rupees only): creates an order and returns its payment session. The browser then opens Cashfree's
     * checkout with that session (a small page of ours does it). Our payment id is the order id, so the webhook matches straight back.
     */
    async cashfreeOrder(i: { amountMinor: number; paymentId: string; description: string; email: string; phone?: string; customerId: string; returnUrl: string; notifyUrl?: string }): Promise<{ id: string; sessionId: string; env: "sandbox" | "production" }> {
      if (!config.cashfree) throw new ProviderError("Cashfree is not set up (CASHFREE_PG_APP_ID, CASHFREE_PG_SECRET_KEY)", 503, "cashfree");
      const env = config.cashfree.env ?? "sandbox";
      const r = await send("cashfree", `${cashfreeBase(env)}/orders`, {
        method: "POST", headers: cashfreeHeaders(config.cashfree),
        body: JSON.stringify({
          order_id: i.paymentId, order_amount: Number(major(i.amountMinor)), order_currency: "INR", order_note: i.description.slice(0, 100),
          customer_details: { customer_id: i.customerId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 50), customer_email: i.email, customer_phone: /^\d{10}$/.test(i.phone ?? "") ? i.phone : "9999999999" },
          order_meta: { return_url: i.returnUrl, ...(i.notifyUrl ? { notify_url: i.notifyUrl } : {}) },
        }),
      });
      if (!r.payment_session_id || !r.order_id) throw new ProviderError("Cashfree did not return a payment session", 502, "cashfree");
      // Use the session id exactly as Cashfree returns it. It really does end in "paymentpayment"; trimming it makes Cashfree reject the session.
      const sessionId = String(r.payment_session_id);
      return { id: String(r.order_id), sessionId, env };
    },
    /** Asks Cashfree directly whether an order is paid (used to double-check a webhook before crediting). */
    async cashfreeOrderStatus(orderId: string): Promise<{ paid: boolean; amountMinor: number | null; currency: string | null }> {
      if (!config.cashfree) throw new ProviderError("Cashfree is not set up (CASHFREE_PG_APP_ID, CASHFREE_PG_SECRET_KEY)", 503, "cashfree");
      const r = await send("cashfree", `${cashfreeBase(config.cashfree.env ?? "sandbox")}/orders/${encodeURIComponent(orderId)}`, { method: "GET", headers: cashfreeHeaders(config.cashfree) });
      return { paid: r.order_status === "PAID", amountMinor: typeof r.order_amount === "number" ? Math.round(r.order_amount * 100) : null, currency: typeof r.order_currency === "string" ? r.order_currency : null };
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
    /** A Stripe Checkout page for the amount in the given currency (INR, USD, EUR, GBP). `amountMinor` is paise or cents. */
    async stripeCheckout(i: { amountMinor: number; currency: string; paymentId: string; description: string; successUrl: string; cancelUrl: string }): Promise<{ id: string; url: string }> {
      if (!config.stripeSecretKey) throw new ProviderError("Stripe is not set up (STRIPE_SECRET_KEY)", 503, "stripe");
      const form = new URLSearchParams({
        mode: "payment", success_url: i.successUrl, cancel_url: i.cancelUrl, client_reference_id: i.paymentId, "metadata[payment_id]": i.paymentId,
        "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": i.currency.toLowerCase(), "line_items[0][price_data][unit_amount]": String(i.amountMinor), "line_items[0][price_data][product_data][name]": i.description,
      });
      const r = await send("stripe", "https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { authorization: `Bearer ${config.stripeSecretKey}`, "content-type": "application/x-www-form-urlencoded" }, body: form });
      if (!r.id || !r.url) throw new ProviderError("Stripe did not return a checkout page", 502, "stripe");
      return { id: String(r.id), url: String(r.url) };
    },
  };
}
