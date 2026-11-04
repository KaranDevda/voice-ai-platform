"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Textarea } from "./ui/form";

interface Result { created: number; updated: number; skippedExisting: number; duplicatesInFile: number; problems: { row: number; reason: string }[] }

/** Add a contact list: a CSV file or pasted rows, with tags that group the people (use a tag to pick who a campaign calls). */
export function ContactsImport() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setResult(null);
    const res = await fetch("/api/contacts/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, tags: tags.split(/[,;|]/).map((t) => t.trim()).filter(Boolean) }) });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.message ?? body.error ?? "Could not import");
    setResult(body as Result);
    router.refresh();
  }

  if (!open) return <Button size="sm" onClick={() => setOpen(true)}>Import contacts</Button>;
  return (
    <Card className="mb-6 w-full">
      <CardHeader title="Import contacts" description="A CSV with a header row. Needs a phone column; name, email, tags and any other columns are kept." action={<Button size="sm" variant="outline" onClick={() => setOpen(false)}>Close</Button>} />
      <CardBody>
        <form onSubmit={submit} className="grid gap-3">
          <input type="file" accept=".csv,.txt,.tsv" aria-label="CSV file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
          <Field label="Or paste the rows"><Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={"name,phone,tags\nAsha,9876543210,diwali"} /></Field>
          <Field label="Tags for everyone in this list" hint="Comma separated, for example: diwali, vip. A campaign can call everyone with a tag."><Input value={tags} onChange={(e) => setTags(e.target.value)} maxLength={200} /></Field>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {result && (
            <div className="text-sm" role="status">
              <p>Added {result.created}, updated {result.updated}{result.skippedExisting ? `, left ${result.skippedExisting} existing as they were` : ""}{result.duplicatesInFile ? `, ${result.duplicatesInFile} repeated in the file` : ""}.</p>
              {result.problems.length > 0 && <ul className="mt-1 list-disc pl-5 text-muted-foreground">{result.problems.slice(0, 10).map((p) => <li key={p.row}>Row {p.row}: {p.reason}</li>)}</ul>}
            </div>
          )}
          <div><Button type="submit" disabled={busy || !text.trim()}>{busy ? "Importing…" : "Import"}</Button></div>
        </form>
      </CardBody>
    </Card>
  );
}
