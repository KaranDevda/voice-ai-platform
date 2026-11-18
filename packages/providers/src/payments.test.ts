import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { createPayments, verifyCryptomusSignature, verifyFlutterwaveHash, verifyPaystackSignature, verifyRazorpaySignature, verifyStripeSignature } from "./payments";

const hmac = (secret: string, text: string) => createHmac("sha256", secret).update(text).digest("hex");

describe("webhook signatures", () => {
  it("Razorpay: accepts the exact body, refuses a changed one or a wrong secret", () => {
    const body = '{"event":"payment_link.paid"}';
    expect(verifyRazorpaySignature(body, hmac("s", body), "s")).toBe(true);
    expect(verifyRazorpaySignature(body + " ", hmac("s", body), "s")).toBe(false);
    expect(verifyRazorpaySignature(body, hmac("s", body), "other")).toBe(false);
    expect(verifyRazorpaySignature(body, undefined, "s")).toBe(false);
  });
  it("Stripe: checks t and v1, and refuses old timestamps", () => {
    const body = '{"type":"checkout.session.completed"}', t = 1_700_000_000;
    const header = `t=${t},v1=${hmac("whsec", `${t}.${body}`)}`;
    expect(verifyStripeSignature(body, header, "whsec", t + 10)).toBe(true);
    expect(verifyStripeSignature(body, header, "whsec", t + 3600)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t},v1=deadbeef`, "whsec", t)).toBe(false);
    expect(verifyStripeSignature(body, null, "whsec", t)).toBe(false);
  });
});

describe("gateway calls", () => {
  it("Razorpay payment link carries the amount in paise and our payment id", async () => {
    let sent: any, auth = "";
    const p = createPayments({ razorpay: { keyId: "k", keySecret: "s" }, fetch: (async (_u: string, init: any) => { sent = JSON.parse(init.body); auth = init.headers.authorization; return new Response(JSON.stringify({ id: "plink_1", short_url: "https://rzp.io/x" })); }) as any });
    expect(await p.razorpayLink({ amountPaise: 50000, paymentId: "pay-uuid", description: "Credit", callbackUrl: "https://app/billing" })).toEqual({ id: "plink_1", url: "https://rzp.io/x" });
    expect(sent).toMatchObject({ amount: 50000, currency: "INR", reference_id: "pay-uuid", notes: { payment_id: "pay-uuid" } });
    expect(auth).toBe(`Basic ${Buffer.from("k:s").toString("base64")}`);
  });
  it("Stripe checkout is made in rupees with our payment id", async () => {
    let form = "";
    const p = createPayments({ stripeSecretKey: "sk", fetch: (async (_u: string, init: any) => { form = String(init.body); return new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.stripe.com/x" })); }) as any });
    expect(await p.stripeCheckout({ amountMinor: 50000, currency: "INR", paymentId: "pay-uuid", description: "Credit", successUrl: "https://a/s", cancelUrl: "https://a/c" })).toEqual({ id: "cs_1", url: "https://checkout.stripe.com/x" });
    expect(form).toContain("line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=inr");
    expect(form).toContain("unit_amount%5D=50000");
    expect(form).toContain("client_reference_id=pay-uuid");
    await p.stripeCheckout({ amountMinor: 1000, currency: "USD", paymentId: "p2", description: "Credit", successUrl: "https://a/s", cancelUrl: "https://a/c" });
    expect(form).toContain("%5Bcurrency%5D=usd"); expect(form).toContain("%5Bunit_amount%5D=1000");
  });
  it("says so plainly when a gateway is not set up", async () => {
    await expect(createPayments({}).razorpayLink({ amountPaise: 10000, paymentId: "x", description: "c", callbackUrl: "https://a" })).rejects.toThrow(/not set up/);
  });
});

describe("more gateways", () => {
  it("Paystack: HMAC-SHA512 of the body", () => {
    const body = '{"event":"charge.success"}', sig = createHmac("sha512", "sk").update(body).digest("hex");
    expect(verifyPaystackSignature(body, sig, "sk")).toBe(true);
    expect(verifyPaystackSignature(body + "x", sig, "sk")).toBe(false);
    expect(verifyPaystackSignature(body, null, "sk")).toBe(false);
  });
  it("Flutterwave: the secret hash must match exactly", () => {
    expect(verifyFlutterwaveHash("abc", "abc")).toBe(true);
    expect(verifyFlutterwaveHash("abd", "abc")).toBe(false);
    expect(verifyFlutterwaveHash(undefined, "abc")).toBe(false);
  });
  it("Cryptomus: md5(base64(body without sign, slashes escaped) + key)", () => {
    const rest = { type: "payment", uuid: "u-1", order_id: "o-1", amount: "10.00", currency: "USD", status: "paid", url: "https://pay.cryptomus.com/pay/u-1" };
    const json = JSON.stringify(rest).replace(/\//g, "\\/");
    const sign = createHash("md5").update(Buffer.from(json).toString("base64") + "key").digest("hex");
    expect(verifyCryptomusSignature({ ...rest, sign }, "key")).toBe(true);
    expect(verifyCryptomusSignature({ ...rest, status: "cancel", sign }, "key")).toBe(false);
    expect(verifyCryptomusSignature(rest, "key")).toBe(false);
  });
  it("PayPal: gets a token, makes an order in dollars and captures it", async () => {
    const calls: string[] = [];
    const p = createPayments({ paypal: { clientId: "c", clientSecret: "s", baseUrl: "https://paypal.test" }, fetch: (async (u: string, init: any) => {
      calls.push(`${init.method} ${new URL(u).pathname}`);
      if (u.endsWith("/oauth2/token")) return new Response(JSON.stringify({ access_token: "tok" }));
      if (u.endsWith("/checkout/orders")) { expect(JSON.parse(init.body).purchase_units[0].amount).toEqual({ currency_code: "USD", value: "10.00" }); return new Response(JSON.stringify({ id: "ORD1", links: [{ rel: "payer-action", href: "https://paypal.test/approve" }] })); }
      return new Response(JSON.stringify({ status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAP1", status: "COMPLETED", amount: { value: "10.00", currency_code: "USD" } }] } }] }));
    }) as any });
    expect(await p.paypalOrder({ amountMinor: 1000, currency: "USD", paymentId: "pid", description: "Credit", returnUrl: "https://a/r", cancelUrl: "https://a/c" })).toEqual({ id: "ORD1", url: "https://paypal.test/approve" });
    expect(await p.paypalCapture("ORD1")).toEqual({ completed: true, captureId: "CAP1", amountMinor: 1000, currency: "USD" });
    expect(calls).toContain("POST /v2/checkout/orders/ORD1/capture");
  });
  it("Flutterwave: verifies a transaction with the secret key and reports what Flutterwave says", async () => {
    let url = "", auth = "";
    const reply = (body: unknown) => createPayments({ flutterwaveSecretKey: "FLWSECK_TEST-x", fetch: (async (u: string, init: any) => { url = u; auth = init.headers.authorization; return new Response(JSON.stringify(body)); }) as any });
    expect(await reply({ status: "success", data: { id: 99, tx_ref: "pid-1", status: "successful", amount: 10.5, currency: "NGN" } }).flutterwaveVerify("99")).toEqual({ successful: true, txRef: "pid-1", amountMinor: 1050, currency: "NGN", id: "99" });
    expect(url).toBe("https://api.flutterwave.com/v3/transactions/99/verify"); expect(auth).toBe("Bearer FLWSECK_TEST-x");
    expect((await reply({ status: "success", data: { id: 99, tx_ref: "pid-1", status: "failed", amount: 10, currency: "NGN" } }).flutterwaveVerify("99")).successful).toBe(false);
  });
});
