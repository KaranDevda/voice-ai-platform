"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./ui/button";

/** Marks an application error resolved, or re-opens it. */
export function ResolveButton({ id, resolved }: { id: string; resolved: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const res = await fetch(`/api/errors/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ resolved: !resolved }) });
      if (res.ok) router.refresh();
    } finally { setBusy(false); }
  }
  return <Button size="sm" variant={resolved ? "outline" : "default"} disabled={busy} onClick={go}>{resolved ? "Re-open" : "Mark resolved"}</Button>;
}
