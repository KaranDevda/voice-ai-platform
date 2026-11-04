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
