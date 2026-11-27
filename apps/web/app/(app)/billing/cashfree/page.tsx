"use client";
import Script from "next/script";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

type CheckoutResult = { error?: { message?: string; type?: string; code?: string }; redirect?: boolean; paymentDetails?: unknown } | undefined;
declare global { interface Window { Cashfree?: (o: { mode: "sandbox" | "production" }) => { checkout: (o: { paymentSessionId: string; redirectTarget?: string }) => Promise<CheckoutResult> } } }

/** Opens Cashfree's own checkout (UPI, cards, netbanking) for the payment session the top-up created. The person returns to Billing afterwards. */
function Checkout() {
  const params = useSearchParams();
  const session = params.get("s") ?? "", mode = params.get("e") === "production" ? "production" : "sandbox";
  const [sdk, setSdk] = useState<"loading" | "ready" | "failed">("loading");
  const [status, setStatus] = useState("");
  const started = useRef(false);

  const open = useCallback(async (target: "_self" | "_modal") => {
    if (!window.Cashfree) { setStatus("The Cashfree payment script did not load. Check your internet connection and press Pay now again."); return; }
    setStatus("Opening Cashfree…");
    try {
      const r = await window.Cashfree({ mode }).checkout({ paymentSessionId: session, redirectTarget: target });
      if (r?.error) setStatus(`Cashfree said: ${r.error.message ?? r.error.code ?? r.error.type ?? "the payment page could not open"}. Go back to Billing and start the payment again.`);
      else if (r?.paymentDetails) setStatus("Payment finished. Go back to Billing: your credit arrives a few seconds after Cashfree confirms it.");
      else if (!r?.redirect) setStatus("Cashfree did not open. Press Pay now to try again.");
    } catch (e) { setStatus(`Could not open the payment page (${e instanceof Error ? e.message : "unknown error"}). Go back to Billing and try again.`); }
  }, [mode, session]);

  useEffect(() => { if (sdk === "ready" && session && !started.current) { started.current = true; void open("_self"); } }, [sdk, session, open]);

  return (
    <div className="mx-auto grid max-w-md gap-4 p-8 text-center text-sm">
      <Script src="https://sdk.cashfree.com/js/v3/cashfree.js" onReady={() => setSdk("ready")} onError={() => setSdk("failed")} />
      {!session ? <p>This payment link is incomplete. Go back to Billing and start again.</p> : (
        <>
          <p>{sdk === "loading" ? "Loading the secure payment page…" : sdk === "failed" ? "The Cashfree payment script could not be loaded. Check your internet connection and reload." : status || "Opening the secure payment page…"}</p>
          <button type="button" disabled={sdk !== "ready"} onClick={() => void open("_modal")} className="mx-auto rounded-lg bg-primary px-5 py-2 font-medium text-white disabled:opacity-50">Pay now</button>
          <p className="text-xs text-muted-foreground">Environment: {mode}. If nothing opens, press Pay now once.</p>
          <a href="/billing" className="text-xs underline">Back to Billing</a>
        </>
      )}
    </div>
  );
}
export default function CashfreeCheckoutPage() { return <Suspense><Checkout /></Suspense>; }
