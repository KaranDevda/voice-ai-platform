"use client";
import { Headphones, Send, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Input } from "./ui/form";

interface LiveCall { id: string; direction: string; startedAt: number; listeners: number }
interface Line { who: "caller" | "ai"; text: string }

/** Live calls right now: listen to both sides, read the transcript as it happens, and have the AI say something to the caller. */
export function ListenIn() {
  const [calls, setCalls] = useState<LiveCall[]>([]);
  const [canSpeak, setCanSpeak] = useState(false);
  const [down, setDown] = useState(false);
  const [joined, setJoined] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [partial, setPartial] = useState("");
  const [say, setSay] = useState("");
  const [note, setNote] = useState("");
  const ws = useRef<WebSocket | null>(null);
  const audio = useRef<{ ctx: AudioContext; next: number; enc: string; rate: number } | null>(null);

  const refresh = useCallback(async () => {
    const r = await fetch("/api/monitor/live", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return;
    const d = (await r.json()) as { calls: LiveCall[]; canSpeak: boolean; voiceServiceDown?: boolean };
    setCalls(d.calls); setCanSpeak(d.canSpeak); setDown(!!d.voiceServiceDown);
  }, []);
  useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 3000); return () => clearInterval(t); }, [refresh]);

  const leave = useCallback(() => {
    ws.current?.close(); ws.current = null;
    void audio.current?.ctx.close().catch(() => {}); audio.current = null;
    setJoined(null);
  }, []);
  useEffect(() => leave, [leave]);

  /** One chunk of the call's sound: the first byte says whose it is (1 = the AI, 2 = the caller); the rest is raw audio. */
  function play(buf: ArrayBuffer) {
    const a = audio.current;
    if (!a) return;
    const kind = new Uint8Array(buf, 0, 1)[0];
    const body = buf.slice(1);
    const fromAi = kind === 1;
    const enc = fromAi ? a.enc : "linear16";
    const rate = fromAi ? a.rate : 16_000;
    let samples: Float32Array;
    if (enc === "mulaw") {
      const u = new Uint8Array(body);
      samples = new Float32Array(u.length);
      for (let i = 0; i < u.length; i++) { const x = ~u[i]!; const t = (((x & 0x0f) << 3) + 0x84) << ((x & 0x70) >> 4); samples[i] = ((x & 0x80) ? 0x84 - t : t - 0x84) / 32768; }
    } else {
      const s = new Int16Array(body.slice(0, body.byteLength - (body.byteLength % 2)));
      samples = new Float32Array(s.length);
      for (let i = 0; i < s.length; i++) samples[i] = s[i]! / 32768;
    }
    if (!samples.length) return;
    const b = a.ctx.createBuffer(1, samples.length, rate);
    b.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const src = a.ctx.createBufferSource();
    src.buffer = b; src.connect(a.ctx.destination);
    const at = Math.max(a.ctx.currentTime + 0.05, a.next);
    src.start(at); a.next = at + b.duration;
  }

  async function join(id: string) {
    leave(); setLines([]); setPartial(""); setNote("");
    const t = await fetch("/api/monitor/token", { method: "POST" });
    if (!t.ok) { setNote("Could not get permission to listen. Sign in again and retry."); return; }
    const { token, url } = (await t.json()) as { token: string; url: string };
    const ctx = new AudioContext();
    await ctx.resume();
    audio.current = { ctx, next: 0, enc: "linear16", rate: 24_000 };
    const socket = new WebSocket(`${url}?token=${encodeURIComponent(token)}&call=${encodeURIComponent(id)}`);
    socket.binaryType = "arraybuffer";
    ws.current = socket;
    socket.onopen = () => setJoined(id);
    socket.onclose = (e) => { if (ws.current === socket) { leave(); setNote(e.code === 4404 ? "That call is over, or you may not listen to it." : "The call ended."); void refresh(); } };
    socket.onerror = () => setNote("Could not reach the voice service.");
    socket.onmessage = (m) => {
      if (typeof m.data !== "string") return play(m.data as ArrayBuffer);
      const e = JSON.parse(m.data) as { type: string; text?: string; audio?: { encoding: string; rate: number } | null; replace?: boolean };
      if (e.type === "joined" || e.type === "ready") { if (e.audio && audio.current) { audio.current.enc = e.audio.encoding; audio.current.rate = e.audio.rate; } }
      else if (e.type === "partial") setPartial(e.text ?? "");
      else if (e.type === "user") { setPartial(""); setLines((l) => (e.replace && l.at(-1)?.who === "caller" ? [...l.slice(0, -1), { who: "caller", text: e.text ?? "" }] : [...l, { who: "caller", text: e.text ?? "" }])); }
      else if (e.type === "assistant") setLines((l) => [...l, { who: "ai", text: e.text ?? "" }]);
      else if (e.type === "clear" && audio.current) audio.current.next = 0;
    };
  }

  function speak() {
    const text = say.trim();
    if (!text || ws.current?.readyState !== 1) return;
    ws.current.send(JSON.stringify({ type: "say", text }));
    setLines((l) => [...l, { who: "ai", text: `[You asked the AI to say] ${text}` }]);
    setSay("");
  }

  return (
    <Card>
      <CardHeader title="Live calls" description="Calls in progress right now. Listen to both sides, follow the transcript, and have the AI say something to the caller. Listening and speaking are recorded in the audit log." />
      <CardBody className="grid gap-3">
        {down && <p role="status" className="text-sm text-warning">The voice service is not reachable, so live calls cannot be listed.</p>}
        {!down && calls.length === 0 && <p className="text-sm text-muted-foreground">No live calls right now. Start a practice call on the Live page in another tab and it will appear here within a few seconds.</p>}
        <ul className="grid gap-2">
          {calls.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <Badge tone="success">Live</Badge>
              <span>{c.direction === "outbound" ? "Outbound" : "Inbound"} call · started {new Date(c.startedAt).toLocaleTimeString()} · {c.listeners} listening</span>
              <span className="flex-1" />
              {joined === c.id
                ? <Button size="sm" variant="outline" onClick={leave}><Square className="h-4 w-4" aria-hidden />Stop listening</Button>
                : <Button size="sm" onClick={() => void join(c.id)}><Headphones className="h-4 w-4" aria-hidden />Listen in</Button>}
            </li>
          ))}
        </ul>
        {note && <p role="status" className="text-sm text-muted-foreground">{note}</p>}
        {joined && (
          <div className="grid gap-2">
            <div className="max-h-72 min-h-32 overflow-y-auto rounded-xl bg-muted p-3 text-sm" aria-live="polite">
              {lines.length === 0 && !partial && <p className="text-muted-foreground">Listening… the transcript appears as people speak.</p>}
              {lines.map((l, i) => <p key={i} className="mb-1"><span className="font-medium">{l.who === "ai" ? "AI" : "Caller"}:</span> {l.text}</p>)}
              {partial && <p className="italic text-muted-foreground">Caller: {partial}</p>}
            </div>
            {canSpeak
              ? (
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); speak(); }}>
                  <Input value={say} onChange={(e) => setSay(e.target.value)} maxLength={300} placeholder="Type something for the AI to say to the caller" aria-label="Message for the AI to say" />
                  <Button type="submit" disabled={!say.trim()}><Send className="h-4 w-4" aria-hidden />Say it</Button>
                </form>
              )
              : <p className="text-xs text-muted-foreground">You can listen, but your role cannot speak into calls.</p>}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
