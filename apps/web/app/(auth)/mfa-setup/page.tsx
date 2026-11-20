"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { T } from "@/components/t";

export default function MfaSetupPage() {
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [error, setError] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);

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
    if (res.ok) setCodes((await res.json()).codes ?? []);
    else setError("That code did not match. Use the current code from your app.");
  }

  if (codes) {
    return (
      <div className="grid gap-4">
        <h1 className="text-lg font-semibold"><T>Save your recovery codes</T></h1>
        <p className="text-sm text-muted-foreground"><T>If you lose your phone, each of these works once in place of the 6-digit code. They are shown only this one time.</T></p>
        <code className="grid grid-cols-2 gap-1 rounded-lg bg-muted px-3 py-2 text-sm tracking-wider">{codes.map((c) => <span key={c}>{c}</span>)}</code>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => void navigator.clipboard.writeText(codes.join("\n"))}>Copy</Button>
          <Button type="button" onClick={() => (window.location.href = "/")}>I saved them, continue</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <h1 className="text-lg font-semibold"><T>Set up two-factor authentication</T></h1>
      <p className="text-sm text-muted-foreground"><T>Your role requires an authenticator app. Add this key, or open the link on your phone, then enter the 6-digit code.</T></p>
      {setup ? (
        <>
          <code className="break-all rounded-lg bg-muted px-3 py-2 text-sm tracking-wider">{setup.secret}</code>
          <a className="text-sm text-primary underline" href={setup.uri}><T>Open in authenticator app</T></a>
          <form onSubmit={confirm} className="grid gap-4">
            <Field label="6-digit code"><Input name="code" inputMode="numeric" pattern="\d{6}" autoComplete="one-time-code" required /></Field>
            {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"><T>{error}</T></p>}
            <Button type="submit">Enable and sign in</Button>
          </form>
        </>
      ) : (
        <p className="text-sm text-muted-foreground"><T>Loading…</T></p>
      )}
    </div>
  );
}
