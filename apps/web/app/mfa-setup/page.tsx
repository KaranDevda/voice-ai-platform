"use client";
import { useEffect, useState, type FormEvent } from "react";

export default function MfaSetupPage() {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/auth/mfa/begin", { method: "POST" }).then(async (r) => {
      if (!r.ok) return void (window.location.href = "/login");
      setSetup(await r.json());
    });
  }, []);

  async function confirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = new FormData(e.currentTarget).get("code");
    const res = await fetch("/api/auth/mfa/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
    if (res.ok) window.location.href = "/";
    else setError("That code did not match. Try the current code from your app.");
  }

  return (
    <main style={{ maxWidth: 420, margin: "10vh auto", fontFamily: "system-ui" }}>
      <h1>Set up two-factor authentication</h1>
      <p>Your role requires an authenticator app. Add this key (or open the link on your phone), then enter the 6-digit code.</p>
      {setup && (
        <>
          <p><code>{setup.secret}</code></p>
          <p><a href={setup.uri}>Open in authenticator app</a></p>
          <form onSubmit={confirm} style={{ display: "grid", gap: 12 }}>
            <input name="code" inputMode="numeric" pattern="\d{6}" placeholder="6-digit code" autoComplete="one-time-code" required />
            {error && <p role="alert">{error}</p>}
            <button type="submit">Enable and sign in</button>
          </form>
        </>
      )}
    </main>
  );
}
