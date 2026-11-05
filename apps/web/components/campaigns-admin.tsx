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
interface Campaign { id: string; name: string; status: string; language: string; startAt: string | null; maxConcurrent: number; maxAttempts: number; retryDelayMin: number; counts: Counts; total: number; mode: "ai" | "audio"; audioName: string | null; detectMachines: boolean; variants: { variant: number; text: string; people: number; reached: number }[] }
type Action = "start" | "pause" | "resume" | "cancel";
const TONE: Record<string, "success" | "danger" | "neutral" | "warning"> = { running: "success", completed: "neutral", cancelled: "danger", paused: "warning", scheduled: "neutral", draft: "neutral" };

/** Create campaigns and run them: start, pause, resume, cancel, with the live count of who is waiting, ringing, done or failed. */
interface HourStat { hourIst: number; attempts: number; answered: number; rate: number }
interface Timing { totalAttempts: number; days: number; minAttempts: number; best: HourStat[]; hours: HourStat[] }
const hourText = (h: number) => `${String(h).padStart(2, "0")}:00`;
/** The next time it is `hourIst`:00 in India, as the local "YYYY-MM-DDTHH:mm" a datetime-local field wants. */
function nextAtIst(hourIst: number): string {
  const now = new Date(), istNow = new Date(now.getTime() + 330 * 60_000);
  let t = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), hourIst) - 330 * 60_000;
  if (t < now.getTime() + 5 * 60_000) t += 86_400_000;
  const d = new Date(t), p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function CampaignsAdmin({ campaigns, timing }: { campaigns: Campaign[]; timing: Timing | null }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [tags, setTags] = useState("");
  const [language, setLanguage] = useState("en-hi");
  const [startAt, setStartAt] = useState("");
  const [concurrent, setConcurrent] = useState(2);
  const [attempts, setAttempts] = useState(2);
  const [retry, setRetry] = useState(60);
  const [machines, setMachines] = useState(true);
  const [mode, setMode] = useState<"ai" | "audio">("ai");
  const [file, setFile] = useState<File | null>(null);
  const [variants, setVariants] = useState(["", "", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const live = campaigns.some((c) => c.status === "running");

  useEffect(() => { if (!live) return; const t = setInterval(() => router.refresh(), 5000); return () => clearInterval(t); }, [live, router]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const res = await fetch("/api/campaigns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      name, language, tags: tags.split(/[,;|]/).map((t) => t.trim()).filter(Boolean), startAt: startAt ? new Date(startAt).toISOString() : undefined,
      maxConcurrent: concurrent, maxAttempts: attempts, retryDelayMin: retry, detectMachines: machines, mode, openingVariants: mode === "audio" ? [] : variants.map((v) => v.trim()).filter(Boolean),
    }) });
    setBusy(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.message ?? body.issues?.[0]?.message ?? body.error ?? "Could not create the campaign");
    if (mode === "audio" && file) {
      const up = await fetch(`/api/campaigns/${body.id}/audio`, { method: "POST", headers: { "x-file-name": encodeURIComponent(file.name) }, body: file });
      if (!up.ok) setError(`The campaign was created, but the recording was not saved: ${((await up.json().catch(() => ({}))) as { message?: string }).message ?? "try again from the list below"}`);
    }
    setName(""); setTags(""); setStartAt(""); setVariants(["", "", ""]); setFile(null);
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
            <Field label="What it does" hint={mode === "audio" ? "Plays your recording, then hangs up" : "An AI conversation"}><Select value={mode} onChange={(e) => setMode(e.target.value as "ai" | "audio")}><option value="ai">AI conversation</option><option value="audio">Play a recording</option></Select></Field>
            {mode === "audio" && <Field label="Recording (MP3 or WAV, up to 5 MB)"><input type="file" accept=".mp3,.wav,audio/mpeg,audio/wav" onChange={(e) => setFile(e.target.files?.[0] ?? null)} aria-label="Recording file" /></Field>}
            <Field label="Language"><Select value={language} onChange={(e) => setLanguage(e.target.value)}><option value="en-hi">Hindi + English</option><option value="hi">Hindi</option><option value="en">English</option></Select></Field>
            <Field label="Start at (optional)" hint={timing?.best[0] ? undefined : "Empty: press Start yourself"}>
              <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              {timing?.best[0] && <button type="button" className="mt-1 text-xs text-primary underline" onClick={() => setStartAt(nextAtIst(timing.best[0]!.hourIst))}>Use the best time: {hourText(timing.best[0].hourIst)} India time</button>}
            </Field>
            <Field label="Calls at once" hint="1 to 20"><Input type="number" min={1} max={20} value={concurrent} onChange={(e) => setConcurrent(Number(e.target.value))} /></Field>
            <Field label="Tries per person" hint="1 to 5"><Input type="number" min={1} max={5} value={attempts} onChange={(e) => setAttempts(Number(e.target.value))} /></Field>
            <Field label="Minutes between tries" hint="5 to 1440"><Input type="number" min={5} max={1440} value={retry} onChange={(e) => setRetry(Number(e.target.value))} /></Field>
            <label className="flex items-center gap-2 text-sm md:col-span-3"><input type="checkbox" checked={machines} onChange={(e) => setMachines(e.target.checked)} /> Hang up when an answering machine picks up, and try again later</label>
            {mode === "ai" && <div className="md:col-span-3 grid gap-2">
              <p className="text-sm font-medium">A/B test (optional): up to 3 opening lines <span className="font-normal text-muted-foreground">— each person hears one; the AI and recording notice is always said first. Use at least two.</span></p>
              {variants.map((v, i) => <Input key={i} value={v} maxLength={300} placeholder={`Opening line ${"ABC"[i]}`} onChange={(e) => setVariants((all) => all.map((x, j) => (j === i ? e.target.value : x)))} />)}
            </div>}
            <div className="flex items-end"><Button type="submit" disabled={busy || !name.trim() || !tags.trim() || (mode === "audio" && !file)}>{busy ? "Creating…" : "Create campaign"}</Button></div>
          </form>
          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        </CardBody>
      </Card>

      {timing && (
        <Card>
          <CardHeader title="Best time to call" description={timing.totalAttempts === 0 ? "No outbound calls in the last 90 days yet." : `Share of outbound calls that were answered, by hour (India time), from ${timing.totalAttempts} calls in the last ${timing.days} days.`} />
          <CardBody className="grid gap-3">
            {timing.best.length > 0
              ? <p className="text-sm">Best hours: {timing.best.map((h) => `${hourText(h.hourIst)} (${Math.round(h.rate * 100)}% answered, ${h.attempts} calls)`).join(" · ")}</p>
              : <p className="text-sm text-muted-foreground">Not enough calls yet to say (at least {timing.minAttempts} in an hour).</p>}
            {timing.hours.length > 0 && (
              <div className="grid gap-1" role="img" aria-label="Answer rate by hour of the day">
                {timing.hours.map((h) => (
                  <div key={h.hourIst} className="grid grid-cols-[3rem_1fr_9rem] items-center gap-2 text-xs">
                    <span className="tabular-nums text-muted-foreground">{hourText(h.hourIst)}</span>
                    <span className="h-2 rounded bg-muted"><span className="block h-2 rounded bg-primary" style={{ width: `${Math.round(h.rate * 100)}%` }} /></span>
                    <span className="tabular-nums text-muted-foreground">{Math.round(h.rate * 100)}% of {h.attempts}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Your campaigns" description={live ? "Updating every few seconds" : undefined} />
        {campaigns.length === 0 ? <CardBody><p className="text-sm text-muted-foreground">No campaigns yet.</p></CardBody> : (
          <Table>
            <thead><tr><Th>Campaign</Th><Th>Status</Th><Th>People</Th><Th>Waiting</Th><Th>Ringing</Th><Th>Done</Th><Th>Failed</Th><Th>Skipped</Th><Th> </Th></tr></thead>
            <tbody>
              {campaigns.map((c) => (
                <Tr key={c.id}>
                  <Td className="font-medium">{c.name}<div className="text-xs font-normal text-muted-foreground">{titleCase(c.language)} · {c.maxConcurrent} at once · {c.maxAttempts} tries{c.startAt ? ` · starts ${formatDateTime(c.startAt)}` : ""}{c.mode === "audio" ? " · plays a recording" : ""}{c.detectMachines ? " · hangs up on answering machines" : ""}</div>
                    {c.mode === "audio" && <div className="mt-1 text-xs font-normal text-muted-foreground">{c.audioName ? `Recording: ${c.audioName}` : "No recording yet: upload one before starting."}{["draft", "scheduled", "paused"].includes(c.status) && <> <label className="cursor-pointer text-primary underline">{c.audioName ? "Replace" : "Upload"}<input type="file" className="sr-only" accept=".mp3,.wav,audio/mpeg,audio/wav" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setError(""); const up = await fetch(`/api/campaigns/${c.id}/audio`, { method: "POST", headers: { "x-file-name": encodeURIComponent(f.name) }, body: f }); if (!up.ok) setError(((await up.json().catch(() => ({}))) as { message?: string }).message ?? "Could not save the recording"); router.refresh(); }} /></label></>}</div>}
                    {c.variants.length > 0 && <ul className="mt-1 text-xs font-normal text-muted-foreground">{c.variants.map((v) => <li key={v.variant}>{"ABC"[v.variant - 1]}: {v.reached} of {v.people} reached ({v.people ? Math.round((100 * v.reached) / v.people) : 0}%) — “{v.text.slice(0, 50)}{v.text.length > 50 ? "…" : ""}”</li>)}</ul>}</Td>
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
