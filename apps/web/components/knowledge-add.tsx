"use client";
import { Loader2, Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiError } from "@/lib/api-client";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Textarea } from "./ui/form";
import { cn } from "@/lib/utils";
import { T } from "./t";

export function KnowledgeAdd() {
  const router = useRouter();
  const [tab, setTab] = useState<"paste" | "file" | "url">("paste");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true); setError(""); setDone("");
    const res = tab === "paste" || tab === "url"
      ? await fetch("/api/knowledge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(tab === "url" ? { title: f.get("title"), sourceUrl: f.get("sourceUrl") } : { title: f.get("title"), text: f.get("text") }) })
      : await fetch("/api/knowledge", { method: "POST", body: f });
    setBusy(false);
    if (!res.ok) return setError((await apiError(res)).message);
    const { chunks } = await res.json();
    setDone(`Added. Split into ${chunks} searchable passage${chunks === 1 ? "" : "s"}.`);
    form.reset();
    router.refresh();
  }

  return (
    <Card>
      <CardHeader title="Add knowledge" description="The AI can answer from pasted text, uploaded documents, or a public web page." />
      <CardBody>
        <div className="mb-4 flex gap-1" role="tablist">
          {(["paste", "file", "url"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)} className={cn("rounded-full px-3 py-1 text-sm", tab === t ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground hover:bg-muted")}><T>{t === "paste" ? "Paste text" : t === "file" ? "Upload file" : "Import URL"}</T></button>)}
        </div>
        <form onSubmit={submit} className="grid gap-4">
          {tab === "paste" ? (
            <>
              <Field label="Title"><Input name="title" required maxLength={200} placeholder="Refund policy" /></Field>
              <Field label="Content"><Textarea name="text" required rows={7} placeholder="Paste the text the AI should know…" /></Field>
            </>
          ) : tab === "url" ? (
            <>
              <Field label="Website URL" hint="Public HTML or plain-text pages up to 1 MB are supported."><Input name="sourceUrl" type="url" required placeholder="https://example.com/pricing" /></Field>
              <Field label="Title (optional)" hint="Defaults to the page title."><Input name="title" maxLength={200} /></Field>
            </>
          ) : (
            <>
              <Field label="Title (optional)" hint="Defaults to the file name."><Input name="title" maxLength={200} /></Field>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border px-4 py-8 text-sm hover:bg-muted/50"><Upload className="h-4 w-4" aria-hidden /><T>Choose a .txt, .md, .csv or .html file</T><input name="file" type="file" required accept=".txt,.md,.markdown,.csv,.html,.htm,text/plain,text/html" className="ms-2 max-w-52 text-xs" /></label>
            </>
          )}
          {error && <p role="alert" className="text-sm text-danger"><T>{error}</T></p>}
          {done && <p role="status" className="text-sm text-success">{done}</p>}
          <div><Button type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}Add to knowledge base</Button></div>
        </form>
      </CardBody>
    </Card>
  );
}
