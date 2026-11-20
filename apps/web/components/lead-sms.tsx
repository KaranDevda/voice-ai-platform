"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Textarea } from "./ui/form";
import { formatDateTime, titleCase } from "@/lib/utils";
import { T, useLang } from "./t";

/** Queue one SMS for a lead; the API rechecks consent, DND, KYC and credit. */
interface SmsHistoryRow { id: string; direction: string; body: string; status: string; error: string | null; createdAt: string }
export function LeadSms({ leadId, history }: { leadId: string; history: SmsHistoryRow[] }) {
  const lang = useLang();
  const router = useRouter();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setNote("");
    try {
      const res = await fetch("/api/sms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ leadId, body }) });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) { setError(result.message ?? result.issues?.[0]?.message ?? result.error ?? "Could not queue the text"); return; }
      setNote("Text queued. It will be sent during the allowed hours if the lead is still eligible.");
      setBody("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader title="Text conversation" description={`${history.length} message${history.length === 1 ? "" : "s"} · oldest first`} />
        <CardBody>
          {!history.length ? <p className="text-sm text-muted-foreground"><T>No texts with this lead yet.</T></p> : (
            <ol className="grid gap-3">{history.map((m) => (
              <li key={m.id} className={`rounded-lg border border-border p-3 ${m.direction === "outbound" ? "ms-4 bg-muted/40" : "me-4"}`}>
                <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground"><span><T>{m.direction === "inbound" ? "Received" : "Sent"}</T> · {titleCase(m.status)}</span><time dateTime={m.createdAt}>{formatDateTime(m.createdAt, lang)}</time></div>
                <p className="whitespace-pre-wrap text-sm">{m.body}</p>
                {m.error && <p className="mt-1 text-xs text-danger">{m.error}</p>}
              </li>
            ))}</ol>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Send a text" description="The send is checked again for consent, Do Not Disturb, KYC and available credit." />
        <CardBody>
          <form onSubmit={send} className="grid gap-3">
            <Field label="Message" hint={`${body.length} / 1000. Use {{name}} or an imported field such as {{city}}.`}>
              <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} required />
            </Field>
            {error && <p role="alert" className="text-sm text-danger"><T>{error}</T></p>}
            {note && <p role="status" className="text-sm text-success"><T>{note}</T></p>}
            <Button type="submit" disabled={busy || !body.trim()}>{busy ? "Queuing…" : "Queue text"}</Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
