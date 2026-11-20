"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { T } from "@/components/t";

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
      <h1 className="text-lg font-semibold"><T>Password changed</T></h1>
      <p className="text-sm text-muted-foreground"><T>You can now sign in with your new password.</T></p>
      <Link href="/login" className="rounded-md bg-primary px-4 py-2 text-center text-sm font-medium text-primary-foreground"><T>Sign in</T></Link>
    </div>
  );
  if (!token) return (
    <div className="grid gap-4">
      <h1 className="text-lg font-semibold"><T>This link is not complete</T></h1>
      <Link href="/forgot-password" className="text-sm underline"><T>Ask for a new link</T></Link>
    </div>
  );
  return (
    <form onSubmit={submit} method="post" action="/reset-password" className="grid gap-4">
      <h1 className="text-lg font-semibold"><T>Choose a new password</T></h1>
      <Field label="New password" hint="At least 12 characters. A few random words work well."><Input name="password" type="password" autoComplete="new-password" minLength={12} required /></Field>
      <Field label="New password again"><Input name="again" type="password" autoComplete="new-password" minLength={12} required /></Field>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"><T>{error}</T>{error.includes("link") && <> <Link href="/forgot-password" className="underline"><T>Ask for a new link</T></Link>.</>}</p>}
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save the new password"}</Button>
    </form>
  );
}

export default function ResetPasswordPage() { return <Suspense><ResetForm /></Suspense>; }
