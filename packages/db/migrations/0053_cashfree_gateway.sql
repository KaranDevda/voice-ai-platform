-- Cashfree Payments (UPI, cards, netbanking; rupees) as a top-up gateway.
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_gateway_chk";--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_gateway_chk" CHECK ("gateway" IN ('razorpay','cashfree','stripe','paypal','paystack','flutterwave','cryptomus'));
