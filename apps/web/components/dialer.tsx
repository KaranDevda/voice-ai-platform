"use client";
import { Bot, Check, Delete, Phone, UserRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { normalizePhone } from "@voiceai/shared";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Select } from "./ui/form";
import { Input } from "./ui/form";
import { Notice } from "./ui/page";
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
              <Field label="AI voice" hint={voices.length ? "The AI always says it is an AI assistant first." : "No active voices. An Org Admin must register one."}>
                <Select defaultValue={voices[0]?.id}>{voices.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</Select>
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
            <Button disabled className="mt-3" size="lg"><Phone className="h-4 w-4" aria-hidden /> {blocked ? "Cannot call" : "Call"}</Button>
            <Notice tone="warning">Calling is not connected yet. It needs a Plivo phone number, which is waiting on KYC. The checks above already work.</Notice>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
