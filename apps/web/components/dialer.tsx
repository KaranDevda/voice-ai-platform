"use client";
import { Bot, Check, Delete, Phone, UserRound, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { normalizePhone } from "@voiceai/shared";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Select } from "./ui/form";
import { Input } from "./ui/form";
import { Notice } from "./ui/page";
import { apiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";

interface LeadOption { id: string; name: string | null; phone: string; dnd: boolean }
interface Voice { id: string; label: string; gender: string }

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function istMinutes(now: Date) {
  const p = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(now);
  return Number(p.slice(0, 2)) * 60 + Number(p.slice(3, 5));
}

export function Dialer({ leads, voices, window: win }: { leads: LeadOption[]; voices: Voice[]; window: { windowStart: string; windowEnd: string } }) {
  const [number, setNumber] = useState("");
  const [leadId, setLeadId] = useState("");
  const [mode, setMode] = useState<"human" | "ai">("human");
  const [now, setNow] = useState<Date | null>(null);
  const router = useRouter();
  const [voiceId, setVoiceId] = useState(voices[0]?.id ?? "");
  // idle -> (checked) -> dialling (a person is on the call; timer runs) -> finishing (they say how it went) -> saved
  const [phase, setPhase] = useState<"idle" | "checking" | "dialling" | "finishing" | "saved">("idle");
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [outcome, setOutcome] = useState<"connected" | "missed" | "rejected" | "failed">("connected");
  const [minutesText, setMinutesText] = useState("0");
  const [secondsText, setSecondsText] = useState("0");
  const [problem, setProblem] = useState("");
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const lead = leads.find((l) => l.id === leadId);
  const e164 = number ? normalizePhone(number) : null;
  const inWindow = now ? istMinutes(now) >= minutes(win.windowStart) && istMinutes(now) < minutes(win.windowEnd) : null;
  const checks: Array<{ ok: boolean | null; label: string }> = [
    { ok: number ? !!e164 : null, label: number && !e164 ? "Not a valid phone number" : "Valid phone number" },
    { ok: lead ? !lead.dnd : null, label: lead?.dnd ? "This lead is on Do Not Disturb. Do not call." : "Lead is not on Do Not Disturb" },
    { ok: inWindow, label: inWindow === false ? `Outside the calling window (${win.windowStart}–${win.windowEnd} IST)` : `Inside the calling window (${win.windowStart}–${win.windowEnd} IST)` },
  ];
  const blocked = checks.some((c) => c.ok === false);

  useEffect(() => {
    if (phase !== "dialling" || !startedAt) return;
    const t = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.getTime()) / 1000)), 1000);
    return () => clearInterval(t);
  }, [phase, startedAt]);

  /** The server decides (and records a blocked attempt); the checks shown above are only a preview. */
  async function press() {
    setProblem(""); setPhase("checking");
    const res = await fetch("/api/calls/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(leadId ? { leadId } : { number }) });
    if (!res.ok) { setPhase("idle"); return setProblem((await apiError(res)).message); }
    const r = (await res.json()) as { allowed: boolean; message?: string };
    if (!r.allowed) { setPhase("idle"); return setProblem(r.message ?? "This call is not allowed."); }
    if (mode === "ai") return router.push(`/live?lead=${leadId}&voice=${encodeURIComponent(`profile:${voiceId}`)}`);
    setStartedAt(new Date()); setElapsed(0); setPhase("dialling");
  }

  function finish() {
    setMinutesText(String(Math.floor(elapsed / 60))); setSecondsText(String(elapsed % 60));
    setOutcome(elapsed > 0 ? "connected" : "missed");
    setPhase("finishing");
  }

  async function save() {
    setProblem("");
    const durationS = outcome === "connected" ? Math.max(0, Math.round(Number(minutesText) || 0)) * 60 + Math.max(0, Math.round(Number(secondsText) || 0)) : 0;
    const res = await fetch("/api/calls/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ number, status: outcome, durationS, startedAt: startedAt!.toISOString() }) });
    if (!res.ok) return setProblem((await apiError(res)).message);
    setPhase("saved");
  }

  const reset = () => { setPhase("idle"); setStartedAt(null); setProblem(""); };
  const aiNeedsLead = mode === "ai" && !leadId;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Dial" />
        <CardBody className="grid gap-5">
          <Field label="Lead">
            <Select value={leadId} onChange={(e) => { setLeadId(e.target.value); const l = leads.find((x) => x.id === e.target.value); if (l) setNumber(l.phone); }}>
              <option value="">Choose a lead or type a number…</option>
              {leads.map((l) => <option key={l.id} value={l.id}>{l.name ?? "Unknown caller"} · {l.phone}{l.dnd ? " · DND" : ""}</option>)}
            </Select>
          </Field>
          <div className="relative">
            <Input value={number} onChange={(e) => { setNumber(e.target.value.replace(/[^\d+*#\s]/g, "")); setLeadId(""); }} inputMode="tel" placeholder="+91 98765 43210" aria-label="Phone number" className="h-12 pr-11 text-lg tracking-wide" />
            {number && <button type="button" aria-label="Delete last digit" onClick={() => setNumber((n) => n.slice(0, -1))} className="absolute right-3 top-3.5 text-muted-foreground hover:text-foreground"><Delete className="h-5 w-5" /></button>}
          </div>
          <div className="mx-auto grid w-full max-w-xs grid-cols-3 gap-2">
            {KEYS.map((k) => <Button key={k} type="button" variant="outline" size="lg" className="text-lg" onClick={() => { setNumber((n) => n + k); setLeadId(""); }}>{k}</Button>)}
          </div>
        </CardBody>
      </Card>

      <div className="grid content-start gap-6">
        <Card>
          <CardHeader title="Who makes the call" />
          <CardBody className="grid gap-4">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Caller">
              {([["human", "Me", "You speak to the lead", UserRound], ["ai", "AI assistant", "The AI calls in a staff voice", Bot]] as const).map(([v, t, d, Icon]) => (
                <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => setMode(v)}
                  className={cn("rounded-xl border p-4 text-left transition-colors", mode === v ? "border-primary bg-primary-soft" : "border-border hover:bg-muted")}>
                  <Icon className="mb-2 h-5 w-5 text-primary" aria-hidden /><div className="text-sm font-semibold">{t}</div><div className="text-xs text-muted-foreground">{d}</div>
                </button>
              ))}
            </div>
            {mode === "ai" && (
              <Field label="AI voice" hint={voices.length ? "The AI opens with the greeting from Settings." : "No active voices. An Org Admin must register one."}>
                <Select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>{voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</Select>
              </Field>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Before you call" />
          <CardBody className="grid gap-2.5 text-sm">
            {checks.map((c) => (
              <div key={c.label} className="flex items-start gap-2">
                {c.ok === true ? <Check className="mt-0.5 h-4 w-4 text-success" aria-label="Pass" /> : c.ok === false ? <X className="mt-0.5 h-4 w-4 text-danger" aria-label="Fail" /> : <span className="mt-1.5 h-2 w-2 rounded-full bg-border" aria-label="Waiting" />}
                <span className={cn(c.ok === false && "text-danger")}>{c.label}</span>
              </div>
            ))}
            {aiNeedsLead && <p className="text-xs text-muted-foreground">Choose a lead on the left: the AI call follows that lead's Do Not Disturb and consent.</p>}
            {phase === "idle" || phase === "checking" ? (
              <Button className="mt-3" size="lg" disabled={blocked || phase === "checking" || !number || aiNeedsLead || (mode === "ai" && !voiceId)} onClick={press}>
                <Phone className="h-4 w-4" aria-hidden /> {phase === "checking" ? "Checking…" : blocked ? "Cannot call" : mode === "ai" ? "Start AI practice call" : "Call"}
              </Button>
            ) : phase === "dialling" ? (
              <div className="mt-3 grid gap-3 rounded-xl border border-primary bg-primary-soft p-4">
                <div className="text-sm font-semibold">Cleared to call {e164 ?? number}</div>
                <a href={`tel:${e164 ?? number}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"><Phone className="h-4 w-4" aria-hidden /> Open in my phone app</a>
                <div className="text-xs text-muted-foreground">Time since cleared: {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}. Press Finish when the call ends, then log how it went.</div>
                <Button variant="outline" onClick={finish}>Finish call</Button>
              </div>
            ) : phase === "finishing" ? (
              <div className="mt-3 grid gap-3 rounded-xl border border-border p-4">
                <div className="text-sm font-semibold">How did the call go?</div>
                <Select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)} aria-label="Outcome">
                  <option value="connected">Connected, we spoke</option><option value="missed">No answer</option><option value="rejected">Declined</option><option value="failed">Could not connect</option>
                </Select>
                {outcome === "connected" && (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Minutes"><Input inputMode="numeric" value={minutesText} onChange={(e) => setMinutesText(e.target.value.replace(/\D/g, ""))} /></Field>
                    <Field label="Seconds"><Input inputMode="numeric" value={secondsText} onChange={(e) => setSecondsText(e.target.value.replace(/\D/g, ""))} /></Field>
                  </div>
                )}
                <Button onClick={save}>Save to call logs</Button>
              </div>
            ) : (
              <div className="mt-3 grid gap-3 rounded-xl border border-success p-4">
                <div className="flex items-center gap-2 text-sm font-semibold"><Check className="h-4 w-4 text-success" aria-hidden /> Saved to the call logs</div>
                <Button variant="outline" onClick={() => { reset(); setNumber(""); setLeadId(""); }}>Make another call</Button>
              </div>
            )}
            {problem && <Notice tone="warning">{problem}</Notice>}
            <Notice tone="info">{mode === "ai"
              ? "AI calls run as practice calls in this browser: you play the lead. Calling real numbers needs the company phone line, which is waiting on the carrier's KYC."
              : "Your call goes out from your own phone or this computer, because the company phone line is not connected yet. It is checked first and logged after, so it shows on the lead."}</Notice>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
