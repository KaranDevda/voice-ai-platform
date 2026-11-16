"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Textarea } from "./ui/form";

interface Result { created: number; updated: number; skippedExisting: number; duplicatesInFile: number; problems: { row: number; reason: string }[] }

/** Add a contact list: a CSV file or pasted rows, with tags that group the people (use a tag to pick who a campaign calls). */
export function ContactsImport({ canExport }: { canExport: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportBytes, setExportBytes] = useState(0);
  const [exportMessage, setExportMessage] = useState("");
  const [importProgress, setImportProgress] = useState<{ processed: number; total: number } | null>(null);

  async function exportContacts() {
    setExporting(true); setExportBytes(0); setExportMessage(""); setError("");
    try {
      const res = await fetch("/api/contacts/export");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message ?? body.error ?? "Could not export contacts"); return;
      }
      if (!res.body) throw new Error("The server did not return an export stream");
      const reader = res.body.getReader(), chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); bytes += value.length; setExportBytes(bytes);
      }
      const blob = new Blob(chunks, { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = url; anchor.download = `contacts-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
      setExportMessage(`Export downloaded (${Math.ceil(bytes / 1024)} KB).`);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not export contacts"); }
    finally { setExporting(false); }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setResult(null); setImportProgress({ processed: 0, total: 0 });
    try {
      const res = await fetch("/api/contacts/import", { method: "POST", headers: { "content-type": "application/json", accept: "application/x-ndjson" }, body: JSON.stringify({ text, tags: tags.split(/[,;|]/).map((t) => t.trim()).filter(Boolean) }) });
      if (!res.ok) { const body = await res.json().catch(() => ({})); setError(body.message ?? body.error ?? "Could not import"); return; }
      if (!res.body) throw new Error("The server did not return import progress");
      const reader = res.body.getReader(), decoder = new TextDecoder();
      let pending = "", finished = false;
      const handleLine = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line) as { type: string; processed?: number; total?: number; result?: Result; message?: string };
        if (event.type === "progress") setImportProgress({ processed: event.processed ?? 0, total: event.total ?? 0 });
        if (event.type === "done" && event.result) { setResult(event.result); finished = true; }
        if (event.type === "error") throw new Error(event.message ?? "Could not import");
      };
      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split("\n"); pending = lines.pop() ?? "";
        for (const line of lines) handleLine(line);
        if (done) { if (pending) handleLine(pending); break; }
      }
      if (!finished) throw new Error("The import ended before a result was returned");
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not import"); }
    finally { setBusy(false); setImportProgress(null); }
  }

  if (!open) return <div className="flex flex-wrap gap-2">{canExport && <Button size="sm" variant="outline" onClick={() => void exportContacts()} disabled={exporting}>{exporting ? `Exporting… ${Math.ceil(exportBytes / 1024)} KB` : "Export contacts"}</Button>}<Button size="sm" onClick={() => setOpen(true)}>Import contacts</Button>{exportMessage && <span role="status" className="self-center text-xs text-success">{exportMessage}</span>}{error && <span role="alert" className="self-center text-xs text-danger">{error}</span>}</div>;
  return (
    <Card className="mb-6 w-full">
      <CardHeader title="Import contacts" description="A CSV with a header row. Needs a phone column; name, email, tags and any other columns are kept." action={<div className="flex gap-2">{canExport && <Button size="sm" variant="outline" onClick={() => void exportContacts()} disabled={exporting}>{exporting ? `Exporting… ${Math.ceil(exportBytes / 1024)} KB` : "Export CSV"}</Button>}<Button size="sm" variant="outline" onClick={() => setOpen(false)}>Close</Button></div>} />
      <CardBody>
        <form onSubmit={submit} className="grid gap-3">
          <input type="file" accept=".csv,.txt,.tsv" aria-label="CSV file" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
          <Field label="Or paste the rows"><Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={"name,phone,tags\nAsha,9876543210,diwali"} /></Field>
          <Field label="Tags for everyone in this list" hint="Comma separated, for example: diwali, vip. A campaign can call everyone with a tag."><Input value={tags} onChange={(e) => setTags(e.target.value)} maxLength={200} /></Field>
          {busy && <div className="grid gap-1" role="status" aria-live="polite"><progress className="w-full" max={Math.max(importProgress?.total ?? 0, 1)} value={importProgress?.processed ?? 0} /><p className="text-xs text-muted-foreground">{importProgress?.total ? `Imported ${importProgress.processed} of ${importProgress.total} contacts…` : "Validating CSV…"}</p></div>}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {exportMessage && <p role="status" className="text-sm text-success">{exportMessage}</p>}
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
