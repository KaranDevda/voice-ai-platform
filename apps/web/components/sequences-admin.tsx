"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Textarea } from "./ui/form";
import { titleCase } from "@/lib/utils";

interface Sequence { id: string; name: string; status: string; steps: { delayMin: number; body: string }[]; counts: Record<string, number> }
interface Step { delayMin: number; body: string; dlt: string }
const wait = (m: number) => (m === 0 ? "right away" : m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? "" : "s"} later` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? "" : "s"} later` : `${m} min later`);

/** Build a multi-step text follow-up, enrol people by tag, and pause, resume or stop it. */
export function SequencesAdmin({ sequences }: { sequences: Sequence[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [steps, setSteps] = useState<Step[]>([{ delayMin: 0, body: "", dlt: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [enrol, setEnrol] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const setStep = (i: number, p: Partial<Step>) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, ...p } : x)));

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const res = await fetch("/api/sequences", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, steps: steps.map((s) => ({ delayMin: s.delayMin, body: s.body, ...(s.dlt.trim() ? { dltTemplateId: s.dlt.trim() } : {}) })) }) });
    setBusy(false);
    const b = await res.json().catch(() => ({}));
    if (!res.ok) return setError(b.message ?? b.issues?.[0]?.message ?? b.error ?? "Could not create the sequence");
    setName(""); setSteps([{ delayMin: 0, body: "", dlt: "" }]);
    router.refresh();
  }

  async function post(id: string, body: unknown, ok?: (b: any) => string) {
    setError(""); setNote("");
    const res = await fetch(`/api/sequences/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) setError(b.message ?? b.error ?? "That did not work"); else if (ok) setNote(ok(b));
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title="New sequence" description="Each step is a text. The wait is counted from the step before (from enrolling, for the first)." />
        <CardBody>
          <form onSubmit={create} className="grid gap-4">
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required /></Field>
            {steps.map((s, i) => (
              <div key={i} className="grid gap-2 rounded-md border border-border p-3">
                <div className="flex items-center justify-between text-sm font-medium">Step {i + 1} <span className="font-normal text-muted-foreground">{wait(s.delayMin)}</span></div>
                <Textarea rows={2} value={s.body} onChange={(e) => setStep(i, { body: e.target.value })} maxLength={1000} placeholder="Message" required />
                <div className="grid gap-2 sm:grid-cols-3">
                  <Field label="Wait (minutes)"><Input type="number" min={0} max={43200} value={s.delayMin} onChange={(e) => setStep(i, { delayMin: Number(e.target.value) })} /></Field>
                  <Field label="DLT template ID" hint="India"><Input value={s.dlt} onChange={(e) => setStep(i, { dlt: e.target.value })} inputMode="numeric" maxLength={30} /></Field>
                  {steps.length > 1 && <div className="flex items-end"><Button type="button" size="sm" variant="outline" onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}>Remove step</Button></div>}
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              {steps.length < 10 && <Button type="button" variant="outline" onClick={() => setSteps((x) => [...x, { delayMin: 1440, body: "", dlt: "" }])}>Add a step</Button>}
              <Button type="submit" disabled={busy || !name.trim() || steps.some((s) => !s.body.trim())}>{busy ? "Creating…" : "Create sequence"}</Button>
            </div>
          </form>
          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
          {note && <p role="status" className="mt-3 text-sm text-success">{note}</p>}
        </CardBody>
      </Card>

      {sequences.map((q) => (
        <Card key={q.id}>
          <CardHeader title={q.name} description={`${q.steps.length} step${q.steps.length === 1 ? "" : "s"} · active ${q.counts.active ?? 0} · paused ${q.counts.paused ?? 0} · finished ${q.counts.completed ?? 0} · stopped ${q.counts.stopped ?? 0}`} action={<Badge tone={q.status === "active" ? "success" : "neutral"}>{titleCase(q.status)}</Badge>} />
          <CardBody className="grid gap-3">
            <ol className="list-decimal pl-5 text-sm">{q.steps.map((s, i) => <li key={i}><span className="text-muted-foreground">{wait(s.delayMin)}:</span> {s.body}</li>)}</ol>
            {q.status === "active" && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1"><Field label="Enrol everyone with tags"><Input value={enrol[q.id] ?? ""} onChange={(e) => setEnrol((x) => ({ ...x, [q.id]: e.target.value }))} placeholder="diwali, vip" /></Field></div>
                <Button size="sm" disabled={!(enrol[q.id] ?? "").trim()} onClick={() => void post(q.id, { enrollTags: (enrol[q.id] ?? "").split(/[,;|]/).map((t) => t.trim()).filter(Boolean) }, (b) => `Enrolled ${b.added}${b.alreadyIn ? `, ${b.alreadyIn} were already in` : ""}.`)}>Enrol</Button>
                <Button size="sm" variant="outline" onClick={() => void post(q.id, { action: "pause" })}>Pause all</Button>
                <Button size="sm" variant="outline" onClick={() => void post(q.id, { action: "resume" })}>Resume all</Button>
                <Button size="sm" variant="outline" onClick={() => { if (confirm("Stop everyone in this sequence? They will get no more texts from it.")) void post(q.id, { action: "stop" }); }}>Stop all</Button>
                <Button size="sm" variant="outline" onClick={() => { if (confirm("Archive this sequence? It stops everyone in it.")) void post(q.id, { action: "archive" }); }}>Archive</Button>
              </div>
            )}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
