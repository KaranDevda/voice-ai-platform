"use client";
import { AudioLines, Loader2, Mic, MicOff, Pause, Play, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Select } from "./ui/form";
import { Notice } from "./ui/page";
import type { VoiceChoice } from "./voice-picker";
import { T, Tf } from "./t";
import { AvatarVideo } from "./avatar-3d";
import type { AvatarStream } from "@/lib/avatar-stream";

type Phase = "idle" | "connecting" | "live";
type AiState = "listening" | "thinking" | "speaking";
interface Line { who: "you" | "ai"; text: string }
interface Timing {
  turn: number; heardToSound: number | null; llmFirstTokenMs: number; firstSentenceMs: number; ttsFirstAudioMs: number; totalMs: number;
  answerMs?: number; speechToTextMs?: number; heardMs?: number; answerHeardMs?: number; source?: "model" | "saved_answer" | "scripted"; audioFromCache?: boolean;
}
const SOURCE_LABEL: Record<string, string> = { model: "AI model", saved_answer: "Saved answer", scripted: "Fixed line" };
const ms = (v: number | undefined) => (v === undefined ? "–" : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v} ms`);

/** Free built-in voices from the self-hosted engine; cloned staff voices come from the database. */
const BUILT_IN = ["alba", "anna", "azelma", "cosette", "eponine", "eve", "fantine", "jane", "mary", "vera", "marius", "javert", "jean", "charles", "george", "paul", "michael"];
const LOUD = 0.02; // microphone level that counts as speech, for the "you stopped talking" mark

/** `lead` is set when the AI is "calling" a lead from the dialer: the service then applies Do Not Disturb, consent and calling hours before it speaks, and saves the call. */
export function LiveVoice({ voices, lead, initialVoice }: { voices: VoiceChoice[]; lead?: { id: string; name: string | null; phone: string }; initialVoice?: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [ai, setAi] = useState<AiState>("listening");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [voice, setVoice] = useState(voices.find((v) => v.ref === initialVoice)?.ref ?? voices.find((v) => v.group === "cloned")?.ref ?? "pocket:alba");
  const [language, setLanguage] = useState<"en" | "hi" | "en-hi">("en-hi");
  const [listen, setListen] = useState<"close" | "anyone" | "push">("close");
  const [talking, setTalking] = useState(false); // hold-to-talk button or Space is down
  const [muted, setMuted] = useState(false);
  const [onHold, setOnHold] = useState(false);
  const [dialed, setDialed] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [partial, setPartial] = useState("");
  const [timings, setTimings] = useState<Timing[]>([]);
  const [level, setLevel] = useState(0);

  const ws = useRef<WebSocket | null>(null);
  const mic = useRef<{ stream: MediaStream; ctx: AudioContext } | null>(null);
  const play = useRef<{ ctx: AudioContext; next: number; sources: AudioBufferSourceNode[]; rate: number } | null>(null);
  const avatar = useRef<AvatarStream | null>(null);   // talking-face video for the AI's voice, when an avatar server is connected
  const [avatarOn, setAvatarOn] = useState(true);
  const lastLoud = useRef(0);
  const heardAt = useRef<number | null>(null); // when the caller last stopped speaking, for the turn now being answered
  const awaitingSound = useRef<number | null>(null);
  const pendingPerceived = useRef(new Map<number, number>());
  const endRef = useRef<HTMLDivElement>(null);
  const listenRef = useRef(listen);
  const heldRef = useRef(false);
  const mutedRef = useRef(false);
  const holdRef = useRef(false);
  useEffect(() => { listenRef.current = listen; }, [listen]);

  const stopAudio = useCallback(() => {
    const p = play.current;
    if (!p) return;
    p.sources.forEach((s) => { try { s.stop(); } catch { /* already finished */ } });
    p.sources = [];
    p.next = 0;
  }, []);

  const stop = useCallback(() => {
    try { ws.current?.send(JSON.stringify({ type: "stop" })); } catch { /* socket already closed */ }
    ws.current?.close();
    ws.current = null;
    mic.current?.stream.getTracks().forEach((t) => t.stop());
    void mic.current?.ctx.close();
    mic.current = null;
    stopAudio();
    avatar.current?.clear();
    void play.current?.ctx.close();
    play.current = null;
    mutedRef.current = false;
    setMuted(false);
    setPhase("idle"); setAi("listening"); setPartial(""); setLevel(0);
  }, [stopAudio]);

  useEffect(() => () => stop(), [stop]);

  const hold = useCallback((down: boolean) => { heldRef.current = down; setTalking(down); }, []);
  useEffect(() => {
    // Space is hold-to-talk, but not while typing in a field or pressing a button.
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName);
    const down = (e: KeyboardEvent) => { if (e.code === "Space" && listenRef.current === "push" && !e.repeat && !typing(e.target)) { e.preventDefault(); hold(true); } };
    const up = (e: KeyboardEvent) => { if (e.code === "Space" && heldRef.current) { e.preventDefault(); hold(false); } };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", () => hold(false));
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [hold]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [lines, partial]);

  function onAudio(buf: ArrayBuffer) {
    const p = play.current;
    if (!p || !buf.byteLength) return;
    if (awaitingSound.current !== null && heardAt.current !== null) {
      pendingPerceived.current.set(awaitingSound.current, Math.round(performance.now() - heardAt.current));
      awaitingSound.current = null;
    }
    const pcm = new Int16Array(buf.byteLength >> 1);
    new Uint8Array(pcm.buffer).set(new Uint8Array(buf, 0, pcm.length * 2));
    const f = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) f[i] = pcm[i]! / 32768;
    const ab = p.ctx.createBuffer(1, f.length, p.rate);
    ab.copyToChannel(f, 0);
    const src = p.ctx.createBufferSource();
    src.buffer = ab;
    src.connect(p.ctx.destination);
    // With an avatar, the first sound of each answer is held back a little so the video of the mouth is ready when it plays.
    const av = avatarOn ? avatar.current : null;
    const idle = p.next <= p.ctx.currentTime + 0.01;
    const at = idle && av ? p.ctx.currentTime + av.startDelay() : Math.max(p.next, p.ctx.currentTime + 0.02);
    av?.push(buf.slice(0, pcm.length * 2), p.rate, p.ctx, at, ab.duration);
    src.start(at);
    p.next = at + ab.duration;
    p.sources.push(src);
    src.onended = () => { p.sources = p.sources.filter((s) => s !== src); };
  }

  function onEvent(e: Record<string, unknown>) {
    switch (e.type) {
      case "ready": {
        const a = e.audio as { rate: number };
        if (!play.current) {
          setError("Audio playback did not initialize. Stop and start the call again.");
          stop();
          return;
        }
        play.current.rate = a.rate;
        setPhase("live");
        break;
      }
      case "state": setAi(e.state as AiState); break;
      case "partial": setPartial(String(e.text)); break;
      case "user":
        setPartial("");
        setLines((l) => {
          const line: Line = { who: "you", text: String(e.text) };
          // The caller kept talking: show one line, not two.
          return e.replace && l.at(-1)?.who === "you" ? [...l.slice(0, -1), line] : [...l, line];
        });
        heardAt.current = lastLoud.current || performance.now();
        awaitingSound.current = Number(e.turn);
        break;
      case "assistant": setLines((l) => [...l, { who: "ai", text: String(e.text) }]); break;
      case "clear": stopAudio(); avatar.current?.clear(); break;
      case "timing": {
        const t = e as unknown as Timing;
        setTimings((l) => [...l.slice(-4), { ...t, heardToSound: pendingPerceived.current.get(t.turn) ?? null }]);
        break;
      }
      case "notice": setNotice(String(e.message)); break;
      case "handoff": {
        const why: Record<string, string> = { person: "asked for a person", complaint: "has a complaint", payment: "has a payment problem", pipeline_error: "the AI could not help" };
        setNotice(`Human handoff requested: the caller ${why[String(e.reason)] ?? "needs a person"}. This practice call cannot transfer to a person. Real phone calls transfer to the configured handoff number.`);
        break;
      }
      case "blocked": setError(String(e.message)); break;
      case "error": setError(String(e.message)); break;
    }
  }

  /** Hold: the caller's microphone is silenced and the AI's speech is paused until the call is resumed. */
  function toggleHold() {
    holdRef.current = !holdRef.current;
    setOnHold(holdRef.current);
    const ctx = play.current?.ctx;
    if (ctx) void (holdRef.current ? ctx.suspend() : ctx.resume());
  }

  const TONES: Record<string, [number, number]> = { "1": [697, 1209], "2": [697, 1336], "3": [697, 1477], "4": [770, 1209], "5": [770, 1336], "6": [770, 1477], "7": [852, 1209], "8": [852, 1336], "9": [852, 1477], "*": [941, 1209], "0": [941, 1336], "#": [941, 1477] };
  /** Keypad: plays the touch-tone locally, shows the digit, and tells the voice service which key was pressed. */
  function pressKey(digit: string) {
    setDialed((d) => (d + digit).slice(-24));
    try { ws.current?.send(JSON.stringify({ type: "dtmf", digit })); } catch { /* socket closed */ }
    const tone = TONES[digit];
    const ctx = mic.current?.ctx;
    if (!tone || !ctx) return;
    const gain = ctx.createGain();
    gain.gain.value = 0.12;
    gain.connect(ctx.destination);
    for (const f of tone) { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(gain); o.start(); o.stop(ctx.currentTime + 0.12); }
  }

  async function start() {
    setError(""); setNotice(""); setLines([]); setTimings([]); setPartial("");
    mutedRef.current = false; setMuted(false); holdRef.current = false; setOnHold(false); setDialed("");
    setPhase("connecting");
    try {
      const output = new AudioContext();
      play.current = { ctx: output, next: 0, sources: [], rate: 24_000 };
      await output.resume();
      const tokenRes = await fetch("/api/voice/token", { method: "POST" });
      if (!tokenRes.ok) {
        const why = (await tokenRes.json().catch(() => ({}))) as { message?: string };
        if (tokenRes.status === 401) throw new Error("Your sign-in has expired. Sign in again, then press Start.");
        if (tokenRes.status === 403) throw new Error("This account cannot start a live conversation.");
        throw new Error(why.message ?? `The web app could not start a voice session (HTTP ${tokenRes.status}). Reload the page and try again.`);
      }
      const { token, url } = (await tokenRes.json()) as { token: string; url: string };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const ctx = new AudioContext({ sampleRate: 16_000 });
      await ctx.audioWorklet.addModule("/worklets/pcm-capture.js");
      const node = new AudioWorkletNode(ctx, "pcm-capture");
      ctx.createMediaStreamSource(stream).connect(node);
      mic.current = { stream, ctx };

      const socket = new WebSocket(`${url}?token=${encodeURIComponent(token)}`);
      socket.binaryType = "arraybuffer";
      ws.current = socket;
      socket.onopen = () => socket.send(JSON.stringify({ type: "start", language, voice, greeting: true, listen, ...(lead ? { leadId: lead.id } : {}) }));
      socket.onmessage = (m) => (typeof m.data === "string" ? onEvent(JSON.parse(m.data)) : onAudio(m.data as ArrayBuffer));
      socket.onclose = () => { if (ws.current === socket) stop(); };
      socket.onerror = () => { setError("Could not reach the voice service. Start everything with pnpm dev:stack (it runs the voice service on port 4001 and restarts it if it stops), then try again."); stop(); };
      node.port.onmessage = (m: MessageEvent<ArrayBuffer>) => {
        const s = new Int16Array(m.data);
        // Hold-to-talk: when the button is not held the microphone is replaced by silence, so nothing in the room is heard.
        if (socket.readyState === 1) socket.send(mutedRef.current || holdRef.current || (listenRef.current === "push" && !heldRef.current) ? new ArrayBuffer(m.data.byteLength) : m.data);
        let sum = 0;
        for (let i = 0; i < s.length; i += 4) sum += (s[i]! / 32768) ** 2;
        const rms = Math.sqrt(sum / (s.length / 4));
        if (rms > LOUD) lastLoud.current = performance.now();
        setLevel(mutedRef.current || holdRef.current ? 0 : Math.min(1, rms * 6));
      };
    } catch (e) {
      stop();
      setError(e instanceof DOMException && e.name === "NotAllowedError" ? "Microphone access was blocked. Allow it in the browser and try again." : e instanceof Error ? e.message : "Could not start.");
    }
  }

  const live = phase === "live";
  const cloned = voices.filter((v) => v.group === "cloned");
  const stock = voices.filter((v) => v.group === "stock");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader title="Conversation" description="Wear headphones: the microphone can hear the speaker and mistake the AI for you." action={live ? <Badge tone={ai === "speaking" ? "primary" : ai === "thinking" ? "warning" : "success"}>{ai === "speaking" ? "AI speaking" : ai === "thinking" ? "Thinking" : "Listening"}</Badge> : undefined} />
        <CardBody className="grid gap-4">
          {lead && <Notice tone="info"><Tf text={lead.name ? "Practice call to {name} ({phone}). You play the lead, speaking into this computer; no phone line is used. Do Not Disturb, consent and calling hours are checked first, exactly as for a real call, and the call is saved to the call logs." : "Practice call to an unknown caller ({phone}). You play the lead, speaking into this computer; no phone line is used. Do Not Disturb, consent and calling hours are checked first, exactly as for a real call, and the call is saved to the call logs."} vars={{ name: lead.name ?? "", phone: lead.phone }} /></Notice>}
          {error && <Notice tone="warning"><T>{error}</T></Notice>}
          {notice && <Notice tone="info"><T>{notice}</T></Notice>}
          <div className="min-h-64 max-h-[28rem] overflow-y-auto rounded-xl bg-muted p-4" aria-live="polite">
            {!lines.length && !partial && <p className="text-sm text-muted-foreground"><T>{live ? "Say something. The AI will answer aloud." : "Press Start, allow the microphone, and begin talking."}</T></p>}
            <div className="grid gap-3">
              {lines.map((l, i) => (
                <div key={i} className={l.who === "you" ? "justify-self-end" : "justify-self-start"}>
                  <div className="mb-0.5 text-xs text-muted-foreground"><T>{l.who === "you" ? "You" : "AI"}</T></div>
                  <div className={`max-w-[34rem] rounded-2xl px-4 py-2 text-sm ${l.who === "you" ? "bg-primary-soft" : "bg-card"}`}>{l.text}</div>
                </div>
              ))}
              {partial && <div className="justify-self-end max-w-[34rem] rounded-2xl bg-primary-soft/60 px-4 py-2 text-sm italic text-muted-foreground">{partial}</div>}
              <div ref={endRef} />
            </div>
          </div>
          <div className="flex items-center gap-3">
            {live ? (
              <Button variant="outline" onClick={stop}><Square className="h-4 w-4" aria-hidden />Stop</Button>
            ) : (
              <Button onClick={() => void start()} disabled={phase === "connecting"}>
                {phase === "connecting" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
                {phase === "connecting" ? "Connecting" : "Start"}
              </Button>
            )}
            {live && <Button type="button" variant="outline" onClick={() => { mutedRef.current = !mutedRef.current; setMuted(mutedRef.current); }} aria-pressed={muted} aria-label={muted ? "Unmute microphone" : "Mute microphone"}>{muted ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}{muted ? "Unmute mic" : "Mute mic"}</Button>}
            {live && <Button type="button" variant="outline" onClick={toggleHold} aria-pressed={onHold}>{onHold ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}{onHold ? "Resume call" : "Hold call"}</Button>}
            {live && onHold && <Badge tone="warning">On hold</Badge>}
            {live && listen === "push" && (
              <button type="button" onPointerDown={() => hold(true)} onPointerUp={() => hold(false)} onPointerLeave={() => talking && hold(false)}
                disabled={muted}
                className={`select-none rounded-lg px-4 py-1.5 text-sm font-medium ${talking ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`}
                aria-pressed={talking}><T>{muted ? "Mic muted" : talking ? "Listening…" : "Hold to talk (Space)"}</T></button>
            )}
            {live && (
              <div className="w-full" role="group" aria-label="Keypad">
                <div className="mb-1 h-5 text-sm tabular-nums text-muted-foreground" aria-live="polite"><T>{dialed || "Keypad"}</T></div>
                <div className="grid w-44 grid-cols-3 gap-1">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((k) => (
                    <button key={k} type="button" onClick={() => pressKey(k)} className="rounded-lg border border-border py-1.5 text-sm font-medium hover:bg-muted" aria-label={`Key ${k}`}>{k}</button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex h-8 flex-1 items-center gap-2" aria-hidden>
              <AudioLines className={`h-4 w-4 ${live ? "text-primary" : "text-muted-foreground"}`} />
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} /></div>
            </div>
          </div>
        </CardBody>
      </Card>

      <div className="grid content-start gap-6">
        <Card>
          <CardHeader title="Avatar" description="A real face from your photo, speaking the AI's voice as live video (needs the avatar notebook running on a GPU)." action={<label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={avatarOn} onChange={(e) => setAvatarOn(e.target.checked)} /><T>Show</T></label>} />
          <CardBody className={avatarOn ? "" : "hidden"}><AvatarVideo onStream={(s) => { avatar.current = s; }} /></CardBody>
        </Card>

        <Card>
          <CardHeader title="Settings" description="Applies the next time you press Start." />
          <CardBody className="grid gap-4">
            <Field label="Voice">
              <Select value={voice} onChange={(e) => setVoice(e.target.value)} disabled={live} aria-label="Voice">
                {cloned.length > 0 && <optgroup label="Cloned staff voices">{cloned.map((v) => <option key={v.ref} value={v.ref}>{v.name} · {v.gender}</option>)}</optgroup>}
                <optgroup label="Free built-in voices (self-hosted)">{BUILT_IN.map((n) => <option key={n} value={`pocket:${n}`}>{n.charAt(0).toUpperCase() + n.slice(1)}</option>)}</optgroup>
                <optgroup label="Stock voices (Deepgram)">{stock.map((v) => <option key={v.ref} value={v.ref}>{v.name} · {v.gender}</option>)}</optgroup>
              </Select>
            </Field>
            <Field label="Who should it listen to?" hint={listen === "close" ? "Ignores voices that are quieter than yours, such as people further from the microphone. Speak at your normal volume near the mic." : listen === "push" ? "Hears nothing until you hold the Talk button or the Space bar. The most reliable choice in a noisy room." : "Hears every voice it can pick up. Use only in a quiet room."}>
              <Select value={listen} onChange={(e) => setListen(e.target.value as typeof listen)} disabled={live} aria-label="Who should it listen to">
                <option value="close"><T>Only me, close to the microphone</T></option>
                <option value="push"><T>Hold to talk (Space bar)</T></option>
                <option value="anyone"><T>Anyone nearby</T></option>
              </Select>
            </Field>
            <Field label="Caller language" hint="The AI replies in whatever language you speak: English, Hindi, or a mix of both (Hinglish). The recommended setting detects it as you talk.">
              <Select value={language} onChange={(e) => setLanguage(e.target.value as typeof language)} disabled={live} aria-label="Caller language">
                <option value="en-hi"><T>English, Hindi or Hinglish (recommended)</T></option><option value="en"><T>English only</T></option><option value="hi"><T>Hindi only</T></option>
              </Select>
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Response time" description="Every stage is measured from the same two moments: when you stopped talking, and when your words were written down." />
          <CardBody className="grid gap-3 text-sm">
            {!timings.length && <p className="text-muted-foreground"><T>Each answer shows its timings here.</T></p>}
            {[...timings].reverse().map((t) => (
              <div key={t.turn} className="rounded-lg border border-border p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-muted-foreground"><T>Turn</T> {t.turn} {t.source && <span className="ms-1 rounded bg-muted px-1.5 py-0.5 text-[11px]"><T>{SOURCE_LABEL[t.source] ?? t.source}</T></span>}</span>
                  <span className="text-lg font-semibold" title="You stopped talking, to the first sound sent to you">{ms(t.heardMs ?? t.heardToSound ?? t.totalMs)}</span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <dt><T>You stopped → words written down</T></dt><dd className="text-end">{ms(t.speechToTextMs)}</dd>
                  <dt><T>Words → AI first word</T></dt><dd className="text-end">{t.source === "model" || !t.source ? ms(t.llmFirstTokenMs) : <T>not needed</T>}</dd>
                  <dt><T>Words → first sentence ready</T></dt><dd className="text-end">{t.source === "model" || !t.source ? ms(t.firstSentenceMs) : <T>not needed</T>}</dd>
                  <dt><T>Voice made the first sound in</T></dt><dd className="text-end">{t.audioFromCache ? <T>instant (saved audio)</T> : ms(t.ttsFirstAudioMs)}</dd>
                  <dt><T>Words → first sound</T></dt><dd className="text-end">{ms(t.totalMs)}</dd>
                  <dt><T>You stopped → answer starts</T></dt><dd className="text-end">{ms(t.answerHeardMs)}</dd>
                  {t.heardToSound !== null && <><dt><T>Measured in your browser</T></dt><dd className="text-end">{ms(t.heardToSound)}</dd></>}
                </dl>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
