"use client";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { T } from "@/components/t";

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setError("");
    const res = await fetch("/api/auth/forgot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: new FormData(e.currentTarget).get("email") }) });
    setBusy(false);
    if (res.ok) setSent(true); else setError(res.status === 429 ? "Too many tries. Wait a minute and try again." : "Enter a valid e-mail address.");
  }

  if (sent) return (
    <div className="grid gap-4">
      <h1 className="text-lg font-semibold"><T>Check your e-mail</T></h1>
      <p className="text-sm text-muted-foreground"><T>If that address belongs to an account, we have sent a link to choose a new password. It works for 30 minutes and only once.</T></p>
      <Link href="/login" className="text-sm underline"><T>Back to sign in</T></Link>
    </div>
  );
  return (
    <form onSubmit={submit} method="post" action="/forgot-password" className="grid gap-4">
      <h1 className="text-lg font-semibold"><T>Forgot your password?</T></h1>
      <p className="text-sm text-muted-foreground"><T>Enter your e-mail and we will send you a link to choose a new one.</T></p>
      <Field label="Email"><Input name="email" type="email" autoComplete="username" placeholder="you@company.com" required /></Field>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"><T>{error}</T></p>}
      <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send the link"}</Button>
      <Link href="/login" className="text-center text-sm underline"><T>Back to sign in</T></Link>
    </form>
  );
}
