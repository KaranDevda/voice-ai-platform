"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Textarea } from "./ui/form";
import { Table, Td, Th, Tr } from "./ui/table";
import { formatDateTime, titleCase } from "@/lib/utils";
import { T, useLang } from "./t";

interface Row { id: string; direction: string; body: string; status: string; error: string | null; createdAt: string; name: string | null; phone: string | null }
const TONE: Record<string, "success" | "danger" | "neutral" | "warning"> = { sent: "success", received: "neutral", queued: "warning", sending: "warning", failed: "danger" };

/** Send a text to everyone with a tag, and see what was sent. */
interface Template { id: string; name: string; body: string }

export function SmsAdmin({ counts, rows, templates }: { counts: Record<string, number>; rows: Row[]; templates: Template[] }) {
  const lang = useLang();
  const router = useRouter();
  const [tags, setTags] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [tplName, setTplName] = useState("");

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setNote("");
    const res = await fetch("/api/sms", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: text, tags: tags.split(/[,;|]/).map((t) => t.trim()).filter(Boolean) }) });
    setBusy(false);
    const b = await res.json().catch(() => ({}));
    if (!res.ok) return setError(b.message ?? b.issues?.[0]?.message ?? b.error ?? "Could not queue the message");
    setNote(`Queued for ${b.queued} ${b.queued === 1 ? "person" : "people"}. They are sent in the next minute or so, inside the calling hours.`);
    setText("");
    router.refresh();
  }

  function pickTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (t) setText(t.body);
  }
  async function saveTemplate() {
    setError(""); setNote("");
    const res = await fetch("/api/sms/templates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: tplName, body: text }) });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) return setError(b.message ?? b.issues?.[0]?.message ?? b.error ?? "Could not save the template");
    setNote("Template saved."); setTplName("");
    router.refresh();
  }
  async function removeTemplate(id: string) {
    if (!confirm("Delete this template?")) return;
    await fetch(`/api/sms/templates/${id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title="Send a text" description="To everyone with one of these tags (add tags when you import contacts on the Leads page)." />
        <CardBody>
          <form onSubmit={send} className="grid gap-3">
            <Field label="Tags" hint="Use tags already on your imported leads, e.g. diwali or vip. Commas select people matching any listed tag."><Input value={tags} onChange={(e) => setTags(e.target.value)} required /></Field>
            {templates.length > 0 && <Field label="Start from a template"><select defaultValue="" onChange={(e) => pickTemplate(e.target.value)} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm"><option value=""><T>Choose…</T></option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
            <Field label="Message" hint={`${text.length} / 1000. Use {{name}}, {{first_name}} or an imported column like {{city}}; {{name|there}} gives a fallback. Plivo currently routes India SMS over international (ILDO) routes; its DLT fields are deprecated.`}><Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} required /></Field>
            {error && <p role="alert" className="text-sm text-danger"><T>{error}</T></p>}
            {note && <p role="status" className="text-sm text-success"><T>{note}</T></p>}
            <div className="flex flex-wrap items-end gap-2">
              <Button type="submit" disabled={busy || !text.trim() || !tags.trim()}>{busy ? "Queuing…" : "Send"}</Button>
              <div className="min-w-48"><Input placeholder="Template name" value={tplName} onChange={(e) => setTplName(e.target.value)} maxLength={80} aria-label="Template name" /></div>
              <Button type="button" variant="outline" disabled={!tplName.trim() || !text.trim()} onClick={() => void saveTemplate()}>Save as template</Button>
            </div>
          </form>
        </CardBody>
      </Card>
      {templates.length > 0 && (
        <Card>
          <CardHeader title="Templates" />
          <CardBody className="grid gap-2 text-sm">
            {templates.map((t) => <div key={t.id} className="flex flex-wrap items-center justify-between gap-2"><span><span className="font-medium">{t.name}</span> <span className="text-muted-foreground">{t.body.length > 90 ? `${t.body.slice(0, 90)}…` : t.body}</span></span><Button size="sm" variant="outline" onClick={() => void removeTemplate(t.id)}>Delete</Button></div>)}
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="Recent messages" description={`Queued ${counts.queued ?? 0} · sent ${counts.sent ?? 0} · failed ${counts.failed ?? 0} · received ${counts.received ?? 0}`} />
        {rows.length === 0 ? <CardBody><p className="text-sm text-muted-foreground"><T>No messages yet.</T></p></CardBody> : (
          <Table>
            <thead><tr><Th>When</Th><Th>Person</Th><Th>Direction</Th><Th>Message</Th><Th>Status</Th></tr></thead>
            <tbody>{rows.map((r) => (
              <Tr key={r.id}>
                <Td className="whitespace-nowrap">{formatDateTime(r.createdAt, lang)}</Td>
                <Td>{r.name ?? "-"}<div className="text-xs text-muted-foreground">{r.phone}</div></Td>
                <Td>{titleCase(r.direction)}</Td>
                <Td className="max-w-md">{r.body}</Td>
                <Td><Badge tone={TONE[r.status] ?? "neutral"}>{titleCase(r.status)}</Badge>{r.error && <div className="mt-1 text-xs text-danger">{r.error}</div>}</Td>
              </Tr>
            ))}</tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
