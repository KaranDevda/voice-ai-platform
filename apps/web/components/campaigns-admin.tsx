"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Select } from "./ui/form";
import { Table, Td, Th, Tr } from "./ui/table";
import { formatDateTime, titleCase } from "@/lib/utils";

interface Counts { pending: number; calling: number; done: number; failed: number; skipped: number }
interface Campaign { id: string; name: string; status: string; language: string; startAt: string | null; maxConcurrent: number; maxAttempts: number; retryDelayMin: number; counts: Counts; total: number }
type Action = "start" | "pause" | "resume" | "cancel";
const TONE: Record<string, "success" | "danger" | "neutral" | "warning"> = { running: "success", completed: "neutral", cancelled: "danger", paused: "warning", scheduled: "neutral", draft: "neutral" };

/** Create campaigns and run them: start, pause, resume, cancel, with the live count of who is waiting, ringing, done or failed. */
export function CampaignsAdmin({ campaigns }: { campaigns: Campaign[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [language, setLanguage] = useState("en-hi");
  const [startAt, setStartAt] = useState("");
  const [concurrent, setConcurrent] = useState(2);
  const [attempts, setAttempts] = useState(2);
  const [retry, setRetry] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = campaigns.some((c) => c.status === "running");

  useEffect(() => { if (!live) return; const t = setInterval(() => router.refresh(), 5000); return () => clearInterval(t); }, [live, router]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const res = await fetch("/api/campaigns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      name, language, tags: tags.split(/[,;|]/).map((t) => t.trim()).filter(Boolean), startAt: startAt ? new Date(startAt).toISOString() : undefined,
      maxConcurrent: concurrent, maxAttempts: attempts, retryDelayMin: retry,
    }) });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.message ?? body.issues?.[0]?.message ?? body.error ?? "Could not create the campaign");
    setName(""); setTags(""); setStartAt("");
    router.refresh();
  }

  async function act(id: string, action: Action) {
    if (action === "cancel" && !confirm("Cancel this campaign? Everyone still waiting will not be called.")) return;
    setError("");
    const res = await fetch(`/api/campaigns/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    if (!res.ok) setError(((await res.json().catch(() => ({}))) as { message?: string }).message ?? "That did not work");
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title="New campaign" description="Calls everyone who has one of these tags (add tags when you import contacts on the Leads page). Nobody is called until you press Start, or the start time arrives." />
        <CardBody>
          <form onSubmit={create} className="grid gap-3 md:grid-cols-3">
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required /></Field>
            <Field label="Tags" hint="Comma separated, e.g. diwali, vip"><Input value={tags} onChange={(e) => setTags(e.target.value)} required /></Field>
            <Field label="Language"><Select value={language} onChange={(e) => setLanguage(e.target.value)}><option value="en-hi">Hindi + English</option><option value="hi">Hindi</option><option value="en">English</option></Select></Field>
            <Field label="Start at (optional)" hint="Empty: press Start yourself"><Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} /></Field>
            <Field label="Calls at once" hint="1 to 20"><Input type="number" min={1} max={20} value={concurrent} onChange={(e) => setConcurrent(Number(e.target.value))} /></Field>
            <Field label="Tries per person" hint="1 to 5"><Input type="number" min={1} max={5} value={attempts} onChange={(e) => setAttempts(Number(e.target.value))} /></Field>
            <Field label="Minutes between tries" hint="5 to 1440"><Input type="number" min={5} max={1440} value={retry} onChange={(e) => setRetry(Number(e.target.value))} /></Field>
            <div className="flex items-end"><Button type="submit" disabled={busy || !name.trim() || !tags.trim()}>{busy ? "Creating…" : "Create campaign"}</Button></div>
          </form>
          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Your campaigns" description={live ? "Updating every few seconds" : undefined} />
        {campaigns.length === 0 ? <CardBody><p className="text-sm text-muted-foreground">No campaigns yet.</p></CardBody> : (
          <Table>
            <thead><tr><Th>Campaign</Th><Th>Status</Th><Th>People</Th><Th>Waiting</Th><Th>Ringing</Th><Th>Done</Th><Th>Failed</Th><Th>Skipped</Th><Th> </Th></tr></thead>
            <tbody>
              {campaigns.map((c) => (
                <Tr key={c.id}>
                  <Td className="font-medium">{c.name}<div className="text-xs font-normal text-muted-foreground">{titleCase(c.language)} · {c.maxConcurrent} at once · {c.maxAttempts} tries{c.startAt ? ` · starts ${formatDateTime(c.startAt)}` : ""}</div></Td>
                  <Td><Badge tone={TONE[c.status] ?? "neutral"}>{titleCase(c.status)}</Badge></Td>
                  <Td>{c.total}</Td><Td>{c.counts.pending}</Td><Td>{c.counts.calling}</Td><Td>{c.counts.done}</Td><Td>{c.counts.failed}</Td><Td>{c.counts.skipped}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {(c.status === "draft" || c.status === "scheduled") && <Button size="sm" onClick={() => void act(c.id, "start")}>Start</Button>}
                    {c.status === "running" && <Button size="sm" variant="outline" onClick={() => void act(c.id, "pause")}>Pause</Button>}
                    {c.status === "paused" && <Button size="sm" onClick={() => void act(c.id, "resume")}>Resume</Button>}{" "}
                    {["draft", "scheduled", "running", "paused"].includes(c.status) && <Button size="sm" variant="outline" onClick={() => void act(c.id, "cancel")}>Cancel</Button>}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
