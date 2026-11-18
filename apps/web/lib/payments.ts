import "server-only";
import { createPayments } from "@voiceai/providers";

const env = (k: string) => process.env[k]?.trim() || undefined;
export const paymentGateways = () => createPayments({
  razorpay: env("RAZORPAY_KEY_ID") && env("RAZORPAY_KEY_SECRET") ? { keyId: env("RAZORPAY_KEY_ID")!, keySecret: env("RAZORPAY_KEY_SECRET")! } : undefined,
  stripeSecretKey: env("STRIPE_SECRET_KEY"),
  paypal: env("PAYPAL_CLIENT_ID") && env("PAYPAL_CLIENT_SECRET") ? { clientId: env("PAYPAL_CLIENT_ID")!, clientSecret: env("PAYPAL_CLIENT_SECRET")!, baseUrl: env("PAYPAL_BASE_URL") } : undefined,
  paystackSecretKey: env("PAYSTACK_SECRET_KEY"),
  flutterwaveSecretKey: env("FLUTTERWAVE_SECRET_KEY"),
  cryptomus: env("CRYPTOMUS_MERCHANT_ID") && env("CRYPTOMUS_API_KEY") ? { merchantId: env("CRYPTOMUS_MERCHANT_ID")!, apiKey: env("CRYPTOMUS_API_KEY")! } : undefined,
});
export const gatewayConfigured = () => ({
  razorpay: !!(env("RAZORPAY_KEY_ID") && env("RAZORPAY_KEY_SECRET")), stripe: !!env("STRIPE_SECRET_KEY"),
  paypal: !!(env("PAYPAL_CLIENT_ID") && env("PAYPAL_CLIENT_SECRET")), paystack: !!env("PAYSTACK_SECRET_KEY"),
  flutterwave: !!env("FLUTTERWAVE_SECRET_KEY"), cryptomus: !!(env("CRYPTOMUS_MERCHANT_ID") && env("CRYPTOMUS_API_KEY")),
});
export const razorpayWebhookSecret = () => env("RAZORPAY_WEBHOOK_SECRET") ?? "";
export const stripeWebhookSecret = () => env("STRIPE_WEBHOOK_SECRET") ?? "";
export const paypalWebhookId = () => env("PAYPAL_WEBHOOK_ID") ?? "";
export const paystackSecretKey = () => env("PAYSTACK_SECRET_KEY") ?? "";
export const flutterwaveSecretHash = () => env("FLUTTERWAVE_SECRET_HASH") ?? "";
export const cryptomusApiKey = () => env("CRYPTOMUS_API_KEY") ?? "";
/** The public address of this website, for the gateway to send the person back to. */
export const appUrl = (req: Request) => (env("APP_URL") ?? new URL(req.url).origin).replace(/\/$/, "");

/**
 * For platform staff: per gateway, whether its keys are set, which settings are still missing (names only, never values), and the address the
 * gateway must be told to send its payment notices to. This is the checklist for connecting a gateway; the keys themselves go in the settings file.
 */
export function gatewayStatus(base: string) {
  const defs: { id: string; label: string; keys: string[]; webhookKeys: string[]; path: string; note: string }[] = [
    { id: "razorpay", label: "Razorpay", keys: ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET"], webhookKeys: ["RAZORPAY_WEBHOOK_SECRET"], path: "razorpay-webhook", note: "Webhook event: payment_link.paid" },
    { id: "stripe", label: "Stripe", keys: ["STRIPE_SECRET_KEY"], webhookKeys: ["STRIPE_WEBHOOK_SECRET"], path: "stripe-webhook", note: "Webhook events: checkout.session.completed, checkout.session.async_payment_succeeded, charge.refunded and charge.dispute.created (the last two take credit back automatically)" },
    { id: "paypal", label: "PayPal", keys: ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"], webhookKeys: ["PAYPAL_WEBHOOK_ID"], path: "paypal-webhook", note: "Webhook event: PAYMENT.CAPTURE.COMPLETED. Set PAYPAL_BASE_URL to the sandbox address while testing." },
    { id: "paystack", label: "Paystack", keys: ["PAYSTACK_SECRET_KEY"], webhookKeys: [], path: "paystack-webhook", note: "Webhook event: charge.success (signed with the secret key)" },
    { id: "flutterwave", label: "Flutterwave", keys: ["FLUTTERWAVE_SECRET_KEY"], webhookKeys: ["FLUTTERWAVE_SECRET_HASH"], path: "flutterwave-webhook", note: "Set the same secret hash in their dashboard" },
    { id: "cryptomus", label: "Cryptomus", keys: ["CRYPTOMUS_MERCHANT_ID", "CRYPTOMUS_API_KEY"], webhookKeys: [], path: "cryptomus-webhook", note: "Notices are signed with the API key" },
  ];
  return defs.map((d) => ({
    id: d.id, label: d.label, configured: d.keys.every((k) => !!env(k)), missing: [...d.keys, ...d.webhookKeys].filter((k) => !env(k)),
    webhookUrl: `${base}/api/billing/${d.path}`, note: d.note,
  }));
}
