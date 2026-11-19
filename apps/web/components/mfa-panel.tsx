"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input } from "./ui/form";

/** Turn two-factor authentication on or off, and get recovery codes in case the phone is lost. */
export function MfaPanel({ enabled, required, recoveryLeft }: { enabled: boolean; required: boolean; recoveryLeft: number }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const post = (url: string, body?: object) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const fail = async (res: Response, fallback: string) => { const b = await res.json().catch(() => ({})); setError(b.message ? `${b.message[0].toUpperCase()}${b.message.slice(1)}.` : fallback); };

  async function begin() { setError(""); setBusy(true); const r = await post("/api/account/mfa/begin"); setBusy(false); if (r.ok) setSetup(await r.json()); else await fail(r, "Could not start setup."); }
  async function confirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(""); setBusy(true);
    const r = await post("/api/account/mfa/confirm", { secret: setup?.secret, code: new FormData(e.currentTarget).get("code") });
    setBusy(false);
    if (r.ok) { setCodes((await r.json()).codes); setSetup(null); router.refresh(); } else await fail(r, "That code did not match. Use the current code from your app.");
  }
  async function withPassword(e: FormEvent<HTMLFormElement>, url: string, then: (b: { codes?: string[] }) => void) {
    e.preventDefault(); setError(""); setBusy(true);
    const form = e.currentTarget;
    const r = await post(url, { password: new FormData(form).get("password") });
    setBusy(false);
    if (r.ok) { form.reset(); then(await r.json()); router.refresh(); } else await fail(r, "That did not work.");
  }

  return (
    <Card>
      <CardHeader title="Two-factor authentication" description="A 6-digit code from an authenticator app, asked for after your password." action={enabled ? <Badge tone="success">On</Badge> : <Badge>Off</Badge>} />
      <CardBody className="grid max-w-md gap-4">
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}

        {codes && (
          <div className="grid gap-2 rounded-lg border border-border bg-muted p-3">
            <p className="text-sm font-medium">Save these recovery codes now. They are shown only once.</p>
            <p className="text-xs text-muted-foreground">Each works one time if you lose your phone. Type one in place of the 6-digit code at sign-in.</p>
            <code className="grid grid-cols-2 gap-1 text-sm tracking-wider">{codes.map((c) => <span key={c}>{c}</span>)}</code>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(codes.join("\n"))}>Copy</Button>
              <Button size="sm" variant="outline" onClick={() => setCodes(null)}>I saved them</Button>
            </div>
          </div>
        )}

        {!enabled && !setup && <div><Button onClick={begin} disabled={busy}>Turn on two-factor authentication</Button></div>}

        {setup && (
          <>
            <p className="text-sm text-muted-foreground">Add this key to your authenticator app, or open the link on your phone, then enter the 6-digit code.</p>
            <code className="break-all rounded-lg bg-muted px-3 py-2 text-sm tracking-wider">{setup.secret}</code>
            <a className="text-sm text-primary underline" href={setup.uri}>Open in authenticator app</a>
            <form onSubmit={confirm} className="grid gap-4">
              <Field label="6-digit code"><Input name="code" inputMode="numeric" pattern="\d{6}" autoComplete="one-time-code" required /></Field>
              <div className="flex gap-2"><Button type="submit" disabled={busy}>Confirm and turn on</Button><Button type="button" variant="outline" onClick={() => setSetup(null)}>Cancel</Button></div>
            </form>
          </>
        )}

        {enabled && (
          <>
            <p className="text-sm text-muted-foreground">Recovery codes left: {recoveryLeft}{recoveryLeft === 0 ? ". Make new ones below." : "."}</p>
            <form onSubmit={(e) => withPassword(e, "/api/account/mfa/recovery", (b) => setCodes(b.codes ?? null))} className="grid gap-3">
              <Field label="Password (to make new recovery codes)"><Input name="password" type="password" autoComplete="current-password" required /></Field>
              <div><Button type="submit" variant="outline" disabled={busy}>Make new recovery codes</Button></div>
            </form>
            {required ? (
              <p className="text-xs text-muted-foreground">Your role requires two-factor authentication, so it cannot be turned off. If you lose your phone, an admin can reset it.</p>
            ) : (
              <form onSubmit={(e) => withPassword(e, "/api/account/mfa/disable", () => setCodes(null))} className="grid gap-3">
                <Field label="Password (to turn it off)"><Input name="password" type="password" autoComplete="current-password" required /></Field>
                <div><Button type="submit" variant="outline" disabled={busy}>Turn off</Button></div>
              </form>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
