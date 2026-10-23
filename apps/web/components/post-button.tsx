"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, type ButtonProps } from "./ui/button";

/** Sends a POST (or DELETE) to `url`, then refreshes the page's data or navigates to `redirectTo`. Asks for confirmation first when `confirm` is set. */
export function PostButton({ url, method = "POST", confirm, redirectTo, children, ...props }: { url: string; method?: "POST" | "DELETE"; confirm?: string; redirectTo?: string } & ButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        {...props}
        disabled={busy || props.disabled}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true);
          setError("");
          const res = await fetch(url, { method });
          setBusy(false);
          if (res.ok) (redirectTo ? router.push(redirectTo) : router.refresh());
          else setError("Failed. Try again.");
        }}
      >
        {busy ? "Working…" : children}
      </Button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  );
}
