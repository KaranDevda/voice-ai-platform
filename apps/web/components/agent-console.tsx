"use client";
import { Bot, Loader2, RotateCcw, Send, User, Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Notice } from "./ui/page";
import { Recorder } from "./recorder";
import { VoicePicker, type VoiceChoice } from "./voice-picker";

interface Timing { sttMs?: number; firstTokenMs?: number; totalMs?: number; ttsMs?: number }
interface Source { title: string; snippet: string }
interface Msg { role: "user" | "assistant"; content: string; sources?: Source[]; timing?: Timing; error?: boolean; pending?: boolean }

const TARGET_MS = 1000; // SOP latency budget: about 1 second from the caller stopping to the first AI audio.

export function AgentConsole({ greeting, disclosure, voices, askg1Reachable, hasKb }: { greeting: string; disclosure: string; voices: VoiceChoice[]; askg1Reachable: boolean | null; hasKb: boolean }) {
  const fresh = (): Msg[] => [{ role: "assistant", content: greeting }];
  const [msgs, setMsgs] = useState<Msg[]>(fresh);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [useKb, setUseKb] = useState(hasKb);
  const [speak, setSpeak] = useState(false);
  // A staff voice that speaks Hindi is the best default, because the AI answers in the caller's language.
  const [voice, setVoice] = useState(voices.find((v) => v.group === "cloned" && v.hindi && !v.detail.startsWith("Demo"))?.ref ?? voices.find((v) => v.ref === "dg:aura-2-thalia-en")?.ref ?? voices[0]?.ref ?? "");
  const [speakNote, setSpeakNote] = useState("");
  const [last, setLast] = useState<Timing | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const aborter = useRef<AbortController | null>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" }); }, [msgs]);
  useEffect(() => () => { audio.current?.pause(); aborter.current?.abort(); }, []);

  /** Barge-in: the caller starting to talk (or type) stops the AI's speech immediately. */
  const stopSpeaking = () => { audio.current?.pause(); audio.current = null; };

  const patch = (fn: (m: Msg) => Msg) => setMsgs((l) => l.map((m, i) => (i === l.length - 1 ? fn(m) : m)));

  async function say(text: string): Promise<number | undefined> {
    const t0 = Date.now();
    // Stock voices speak English only: for a Hindi or Hinglish reply, use a staff voice that can speak Hindi instead.
    let useVoice = voice;
    if (/[\u0900-\u097F]/.test(text)) {
      const cur = voices.find((v) => v.ref === voice);
      if (!cur || cur.group === "stock" || cur.hindi === false) {
        const alt = voices.find((v) => v.group === "cloned" && v.hindi && !v.detail.startsWith("Demo"));
        if (alt) { useVoice = alt.ref; setSpeakNote(`This reply is in Hindi, so ${alt.name}'s voice is speaking it. Stock voices speak English only.`); }
        else { setSpeakNote("This reply is in Hindi, and no voice that speaks Hindi is available. Clone a staff voice under Voice clone."); return undefined; }
      } else setSpeakNote("");
    } else setSpeakNote("");
    const res = await fetch("/api/studio/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice: useVoice, save: false }) });
    if (!res.ok) { setSpeakNote("The reply could not be spoken. Check the voice servers (pnpm dev:stack)."); return undefined; }
    const url = URL.createObjectURL(await res.blob());
    const ms = Date.now() - t0;
    const a = new Audio(url);
    a.onended = () => URL.revokeObjectURL(url);
    audio.current = a;
    await a.play().catch(() => {});
    return ms;
  }

  async function send(text: string, sttMs?: number) {
    const q = text.trim();
    if (!q || busy) return;
    stopSpeaking();
    const history = [...msgs.filter((m) => !m.error), { role: "user" as const, content: q }];
    setMsgs([...msgs, { role: "user", content: q }, { role: "assistant", content: "", pending: true }]);
    setInput(""); setBusy(true);
    aborter.current = new AbortController();
    let reply = "";
    let timing: Timing = { sttMs };
    try {
      const res = await fetch("/api/agent/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history.map(({ role, content }) => ({ role, content })), useKnowledge: useKb }), signal: aborter.current.signal });
      if (!res.ok || !res.body) { const e = await apiError(res); return patch((m) => ({ ...m, content: e.hint ? `${e.message} ${e.hint}` : e.message, error: true, pending: false })); }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop() ?? "";
        for (const raw of events) {
          const ev = /^event: (\w+)\ndata: (.*)$/s.exec(raw);
          if (!ev) continue;
          const data = JSON.parse(ev[2]!);
          if (ev[1] === "meta") patch((m) => ({ ...m, sources: data.sources }));
          else if (ev[1] === "token") { reply += data; patch((m) => ({ ...m, content: reply, pending: false })); }
          else if (ev[1] === "done") timing = { ...timing, firstTokenMs: data.firstTokenMs ?? undefined, totalMs: data.totalMs };
          else if (ev[1] === "error") return patch((m) => ({ ...m, content: data.message, error: true, pending: false }));
        }
      }
      patch((m) => ({ ...m, pending: false, timing }));
      setLast(timing);
      if (speak && reply) {
        const ttsMs = await say(reply);
        timing = { ...timing, ttsMs };
        patch((m) => ({ ...m, timing }));
        setLast(timing);
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) patch((m) => ({ ...m, content: "The connection dropped. Try again.", error: true, pending: false }));
    } finally {
      setBusy(false);
    }
  }

  async function onVoice(file: File) {
    setTranscribing(true);
    const t0 = Date.now();
    const form = new FormData();
    form.set("file", file); form.set("language", "multi"); form.set("diarize", "false"); form.set("save", "false");
    try {
      const res = await fetch("/api/studio/transcribe", { method: "POST", body: form });
      if (!res.ok) { const e = await apiError(res); return setMsgs((l) => [...l, { role: "assistant", content: e.message, error: true }]); }
      const { text } = await res.json();
      setTranscribing(false);
      if (!text?.trim()) return setMsgs((l) => [...l, { role: "assistant", content: "I could not hear anything. Try again, a little closer to the microphone.", error: true }]);
      await send(text, Date.now() - t0);
    } finally {
      setTranscribing(false);
    }
  }

  const parts = last ? ([["Speech to text", last.sttMs], ["AI first word", last.firstTokenMs], ["Voice generation", last.ttsMs]] as const).filter(([, v]) => v !== undefined) : [];
  const first = last ? (last.sttMs ?? 0) + (last.firstTokenMs ?? 0) + (last.ttsMs ?? 0) : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="flex flex-col lg:col-span-2">
        <CardHeader title="Conversation" description={`The AI opens every call with: “${disclosure}”`} action={<Button variant="ghost" size="sm" onClick={() => { aborter.current?.abort(); stopSpeaking(); setMsgs(fresh()); setLast(null); setBusy(false); }}><RotateCcw className="h-4 w-4" aria-hidden />Reset</Button>} />
        {askg1Reachable === false && <div className="px-5 pt-4"><Notice tone="warning">AskG1 is not reachable from here. Connect the company VPN, then send a message.</Notice></div>}
        <div className="flex max-h-[28rem] min-h-[18rem] flex-1 flex-col gap-4 overflow-y-auto p-5" aria-live="polite">
          {msgs.map((m, i) => (
            <div key={i} className={cn("flex gap-3", m.role === "user" && "flex-row-reverse")}>
              <span className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full", m.role === "user" ? "bg-info-soft text-info" : "bg-primary-soft text-primary")}>{m.role === "user" ? <User className="h-4 w-4" aria-label="You" /> : <Bot className="h-4 w-4" aria-label="AI agent" />}</span>
              <div className={cn("max-w-[85%]", m.role === "user" && "text-end")}>
                <div className={cn("inline-block whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-start text-sm leading-relaxed", m.error ? "bg-danger-soft text-danger" : m.role === "user" ? "bg-info-soft" : "bg-muted")}>
                  {m.pending && !m.content ? <span className="inline-flex gap-1" aria-label="AI is typing"><span className="rec-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" /><span className="rec-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" /><span className="rec-dot h-1.5 w-1.5 rounded-full bg-muted-foreground" /></span> : m.content}
                </div>
                {m.sources && m.sources.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1.5">{m.sources.map((s, j) => <span key={j} title={s.snippet} className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"><span className="font-semibold text-primary">{j + 1}</span>{s.title}</span>)}</div>}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <div className="grid gap-3 border-t border-border p-4">
          <Recorder label="Speak" maxSeconds={60} disabled={busy || transcribing} onStart={stopSpeaking} onRecorded={(f) => void onVoice(f)} />
          {transcribing && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />Transcribing what you said…</p>}
          <div className="flex items-end gap-2">
            <textarea
              value={input} rows={2} placeholder="Type a message as the caller…" aria-label="Message"
              onChange={(e) => { setInput(e.target.value); if (e.target.value) stopSpeaking(); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
              className="min-h-11 flex-1 resize-none rounded-xl border border-border bg-background px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:border-primary"
            />
            <Button size="lg" disabled={!input.trim() || busy} onClick={() => void send(input)} aria-label="Send">{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}</Button>
          </div>
        </div>
      </Card>

      <div className="grid content-start gap-6">
        <Card>
          <CardHeader title="Test settings" />
          <CardBody className="grid gap-4">
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={useKb} disabled={!hasKb} onChange={(e) => setUseKb(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" /><span>Answer from the knowledge base{!hasKb && <span className="block text-xs text-muted-foreground">No documents yet. Add some in Knowledge base.</span>}</span></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={speak} onChange={(e) => { setSpeak(e.target.checked); if (!e.target.checked) stopSpeaking(); }} className="h-4 w-4 accent-[var(--primary)]" /><Volume2 className="h-4 w-4 text-muted-foreground" aria-hidden />Speak the replies</label>
            {speak && <VoicePicker voices={voices} value={voice} onChange={setVoice} language="hinglish" />}
            {speak && speakNote && <p role="status" className="text-xs text-muted-foreground">{speakNote}</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Last turn speed" description="Live calls stream audio, so they will be faster than this" />
          <CardBody className="grid gap-3">
            {!last ? <p className="text-sm text-muted-foreground">Send a message to see how long each step takes.</p> : (
              <>
                {parts.map(([label, ms]) => (
                  <div key={label}><div className="mb-1 flex justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className="tabular-nums">{ms} ms</span></div><div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-wave" style={{ width: `${Math.min(100, ((ms ?? 0) / Math.max(first, TARGET_MS)) * 100)}%` }} /></div></div>
                ))}
                <div className="flex items-center justify-between border-t border-border pt-3 text-sm"><span className="font-medium">To first audio</span><Badge tone={first <= TARGET_MS ? "success" : first <= 1500 ? "warning" : "danger"}>{first} ms · target {TARGET_MS}</Badge></div>
              </>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
