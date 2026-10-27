"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";

export default function LoginPage() {
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: f.get("email"), password: f.get("password"), totp: f.get("totp") || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) return void (window.location.href = "/");
    if (data.error === "mfa_required") return void setNeedTotp(true);
    if (data.error === "mfa_enrollment_required") return void (window.location.href = "/mfa-setup");
    setError("Invalid email, password or code.");
  }

  // method=post: if the form is submitted before this page's script has loaded, the browser must never put the password in the address (GET would).
  return (
    <form onSubmit={submit} method="post" action="/login" className="grid gap-4">
      <h1 className="text-lg font-semibold">{needTotp ? "Two-factor authentication" : "Welcome back"}</h1>
      <div className={needTotp ? "hidden" : "grid gap-4"}>
        <Field label="Email"><Input name="email" type="email" autoComplete="username" placeholder="you@company.com" required /></Field>
        <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
      </div>
      {needTotp && (
        <Field label="6-digit code" hint="Open your authenticator app and enter the current code.">
          <Input name="totp" inputMode="numeric" pattern="\d{6}" autoComplete="one-time-code" autoFocus required />
        </Field>
      )}
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={busy}>{busy ? "Checking…" : needTotp ? "Verify and sign in" : "Continue"}</Button>
    </form>
  );
}
