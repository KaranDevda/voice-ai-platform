"use client";
import { useState } from "react";

/** Shown on every page while platform staff are acting as someone else. */
export function ImpersonationBanner({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  async function stop() {
    setBusy(true);
    await fetch("/api/platform/impersonate/stop", { method: "POST" });
    window.location.href = "/platform";
  }
  return (
    <div role="alert" className="flex flex-wrap items-center justify-center gap-3 bg-warning px-4 py-2 text-sm font-medium text-black">
      You are acting as {email}. Everything you do is recorded.
      <button type="button" onClick={() => void stop()} disabled={busy} className="rounded-md bg-black/80 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60">{busy ? "Leaving…" : "Back to my account"}</button>
    </div>
  );
}
