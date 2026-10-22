"use client";
import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: f.get("email"), password: f.get("password"), totp: f.get("totp") || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return void (window.location.href = "/");
    if (data.error === "mfa_required") return void setNeedTotp(true);
    if (data.error === "mfa_enrollment_required") return void (window.location.href = "/mfa-setup");
    setError("Invalid email, password or code.");
  }

  return (
    <main style={{ maxWidth: 360, margin: "10vh auto", fontFamily: "system-ui" }}>
      <h1>Sign in</h1>
      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <input name="email" type="email" placeholder="Email" autoComplete="username" required />
        <input name="password" type="password" placeholder="Password" autoComplete="current-password" required />
        {needTotp && <input name="totp" inputMode="numeric" pattern="\d{6}" placeholder="6-digit code" autoComplete="one-time-code" autoFocus required />}
        {error && <p role="alert">{error}</p>}
        <button type="submit">{needTotp ? "Verify" : "Continue"}</button>
      </form>
    </main>
  );
}
