"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

/**
 * Sends the person to Cashfree's own hosted payment page (UPI, cards, netbanking) for the session the top-up created. No script is loaded
 * here, so nothing can get stuck; Cashfree sends the person back to /api/billing/cashfree-return, which credits the order.
 */
function Checkout() {
  const params = useSearchParams();
  const session = params.get("s") ?? "", mode = params.get("e") === "production" ? "production" : "sandbox";
  const url = `https://${mode === "production" ? "payments" : "payments-test"}.cashfree.com/order/#${session}`;
  useEffect(() => { if (session) window.location.assign(url); }, [session, url]);
  return (
    <div className="mx-auto grid max-w-md gap-4 p-8 text-center text-sm">
      {!session ? <p>This payment link is incomplete. Go back to Billing and start again.</p> : (
        <>
          <p>Opening the secure payment page…</p>
          <a href={url} className="mx-auto rounded-lg bg-primary px-5 py-2 font-medium text-white">Pay now</a>
          <p className="text-xs text-muted-foreground">Environment: {mode}. If nothing opens, press Pay now.</p>
          <a href="/billing" className="text-xs underline">Back to Billing</a>
        </>
      )}
    </div>
  );
}
export default function CashfreeCheckoutPage() { return <Suspense><Checkout /></Suspense>; }
