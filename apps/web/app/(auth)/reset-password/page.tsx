"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("again")) return setError("The two passwords are not the same.");
    setBusy(true); setError("");
    const res = await fetch("/api/auth/reset", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password: f.get("password") }) });
    const b = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) return setDone(true);
    setError(b.message ? (b.error === "password" ? `Choose a stronger password: ${b.message}.` : b.message) : "That did not work. Ask for a new link.");
  }

  if (done) return (
    <div className="grid gap-4">
      <h1 className="text-lg font-semibold">Password changed</h1>
      <p className="text-sm text-muted-foreground">You can now sign in with your new password.</p>
      <Link href="/login" className="rounded-md bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground">Sign in</Link>
    </div>
  );
  if (!token) return (
    <div className="grid gap-4">
      <h1 className="text-lg font-semibold">This link is not complete</h1>
      <Link href="/forgot-password" className="text-sm underline">Ask for a new link</Link>
    </div>
  );
  return (
    <form onSubmit={submit} method="post" action="/reset-password" className="grid gap-4">
      <h1 className="text-lg font-semibold">Choose a new password</h1>
      <Field label="New password" hint="At least 12 characters. A few random words work well."><Input name="password" type="password" autoComplete="new-password" minLength={12} required /></Field>
      <Field label="New password again"><Input name="again" type="password" autoComplete="new-password" minLength={12} required /></Field>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}{error.includes("link") && <> <Link href="/forgot-password" className="underline">Ask for a new link</Link>.</>}</p>}
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save the new password"}</Button>
    </form>
  );
}

export default function ResetPasswordPage() { return <Suspense><ResetForm /></Suspense>; }
