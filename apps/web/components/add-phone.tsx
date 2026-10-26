"use client";
import { Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { apiError } from "@/lib/api-client";
import { Button } from "./ui/button";
import { Notice } from "./ui/page";

/** Makes a one-time code to type into the Bizfy Voice AI phone app (Android or iPhone). Valid for 10 minutes, once. */
export function AddPhone() {
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!code) return;
    const tick = () => { const s = Math.max(0, Math.round((code.expiresAt - Date.now()) / 1000)); setLeft(s); if (!s) setCode(null); };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [code]);

  async function make() {
    setBusy(true); setError("");
    const res = await fetch("/api/mobile/pairing-code", { method: "POST" });
    setBusy(false);
    if (!res.ok) return setError((await apiError(res)).message);
    const b = (await res.json()) as { code: string; expiresAt: string };
    setCode({ code: b.code, expiresAt: new Date(b.expiresAt).getTime() });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button size="sm" onClick={make} disabled={busy}><Smartphone className="h-4 w-4" aria-hidden /> {busy ? "Working…" : code ? "New code" : "Add a phone"}</Button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
      {code && (
        <Notice tone="info">
          <div className="text-xs">In the Bizfy Voice AI app on your phone, choose “Link this phone” and type:</div>
          <div className="my-1 font-mono text-2xl font-semibold tracking-[0.25em]" aria-live="polite">{code.code}</div>
          <div className="text-xs">Works once, for {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} more. Never share it.</div>
        </Notice>
      )}
    </div>
  );
}
