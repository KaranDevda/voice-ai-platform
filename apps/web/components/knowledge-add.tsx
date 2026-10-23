"use client";
import { Loader2, Plus, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiError } from "@/lib/api-client";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Textarea } from "./ui/form";
import { cn } from "@/lib/utils";

export function KnowledgeAdd() {
  const router = useRouter();
  const [tab, setTab] = useState<"paste" | "file">("paste");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true); setError(""); setDone("");
    const res = tab === "paste"
      ? await fetch("/api/knowledge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: f.get("title"), text: f.get("text") }) })
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
      <CardHeader title="Add a document" description="The AI answers from these. Plain text, Markdown or CSV." />
      <CardBody>
        <div className="mb-4 flex gap-1" role="tablist">
          {(["paste", "file"] as const).map((t) => <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => setTab(t)} className={cn("rounded-full px-3 py-1 text-sm", tab === t ? "bg-primary-soft font-medium text-primary" : "text-muted-foreground hover:bg-muted")}>{t === "paste" ? "Paste text" : "Upload file"}</button>)}
        </div>
        <form onSubmit={submit} className="grid gap-4">
          {tab === "paste" ? (
            <>
              <Field label="Title"><Input name="title" required maxLength={200} placeholder="Refund policy" /></Field>
              <Field label="Content"><Textarea name="text" required rows={7} placeholder="Paste the text the AI should know…" /></Field>
            </>
          ) : (
            <>
              <Field label="Title (optional)" hint="Defaults to the file name."><Input name="title" maxLength={200} /></Field>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border px-4 py-8 text-sm hover:bg-muted/50"><Upload className="h-4 w-4" aria-hidden />Choose a .txt, .md or .csv file<input name="file" type="file" required accept=".txt,.md,.markdown,.csv,text/plain" className="ml-2 max-w-52 text-xs" /></label>
            </>
          )}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          {done && <p role="status" className="text-sm text-success">{done}</p>}
          <div><Button type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}Add to knowledge base</Button></div>
        </form>
      </CardBody>
    </Card>
  );
}
