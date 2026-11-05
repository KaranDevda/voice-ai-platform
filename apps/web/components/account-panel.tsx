"use client";
import { useState, type FormEvent } from "react";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input } from "./ui/form";

/** Change your own password. */
export function AccountPanel() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget, f = new FormData(form);
    if (f.get("next") !== f.get("again")) return setError("The two new passwords are not the same.");
    setBusy(true); setError(""); setDone(false);
    const res = await fetch("/api/account/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ current: f.get("current"), next: f.get("next") }) });
    const b = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(b.message ? `${b.message[0].toUpperCase()}${b.message.slice(1)}.` : "That did not work.");
    form.reset(); setDone(true);
  }

  return (
    <Card>
      <CardHeader title="Change password" description="Use at least 12 characters. Other signed-in devices stay signed in until their session ends." />
      <CardBody>
        <form onSubmit={submit} className="grid max-w-md gap-4">
          <Field label="Current password"><Input name="current" type="password" autoComplete="current-password" required /></Field>
          <Field label="New password"><Input name="next" type="password" autoComplete="new-password" minLength={12} required /></Field>
          <Field label="New password again"><Input name="again" type="password" autoComplete="new-password" minLength={12} required /></Field>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {done && <p role="status" className="text-sm text-success">Password changed.</p>}
          <div><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Change password"}</Button></div>
        </form>
      </CardBody>
    </Card>
  );
}
