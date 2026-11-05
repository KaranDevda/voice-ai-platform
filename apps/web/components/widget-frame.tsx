"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Phase = "waiting" | "ready" | "connecting" | "live" | "error";
interface Start { token: string; url: string; language: "en" | "hi" | "en-hi"; voice: string }
interface Line { who: "you" | "ai"; text: string }

/**
 * A small voice call with the organisation's AI agent, for the frame on a customer's website. The site's script hands over a 60-second
 * voice pass; the microphone and the voice service connection are opened here, on the app's own address.
 */
/** The address of the site that embedded this frame, given by widget.js in the frame address (?o=). Messages go only to it, and only from it. */
const parentOrigin: string | null = (() => {
  if (typeof window === "undefined") return null;
  try { const o = new URL(new URLSearchParams(window.location.search).get("o") ?? "").origin; return o === "null" ? null : o; } catch { return null; }
})();

export function WidgetFrame() {
  const [phase, setPhase] = useState<Phase>("waiting");
  const [message, setMessage] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const startRef = useRef<Start | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const mic = useRef<{ stream: MediaStream; ctx: AudioContext } | null>(null);
  const play = useRef<{ ctx: AudioContext; next: number; sources: AudioBufferSourceNode[]; rate: number } | null>(null);

  const stopAudio = () => { play.current?.sources.forEach((s) => { try { s.stop(); } catch { /* finished */ } }); if (play.current) play.current.sources = []; };
  const stop = useCallback(() => {
    try { ws.current?.send(JSON.stringify({ type: "stop" })); } catch { /* already closed */ }
    ws.current?.close(); ws.current = null;
    mic.current?.stream.getTracks().forEach((t) => t.stop()); void mic.current?.ctx.close(); mic.current = null;
    stopAudio(); void play.current?.ctx.close(); play.current = null;
    setSpeaking(false);
  }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent || e.origin !== parentOrigin || !e.data) return;
      if (e.data.type === "voiceai-start" && typeof e.data.token === "string") {
        startRef.current = { token: e.data.token, url: String(e.data.url), language: e.data.language, voice: String(e.data.voice) };
        setPhase("ready");
      } else if (e.data.type === "voiceai-error") { setMessage(String(e.data.message)); setPhase("error"); }
    };
    window.addEventListener("message", onMessage);
    if (!parentOrigin) { setMessage("This widget is not set up correctly on the website."); setPhase("error"); return () => window.removeEventListener("message", onMessage); }
    window.parent.postMessage({ type: "voiceai-ready" }, parentOrigin); // only the site that embedded this frame (never "*")
    return () => { window.removeEventListener("message", onMessage); stop(); };
  }, [stop]);

  function onAudio(buf: ArrayBuffer) {
    const p = play.current;
    if (!p) return;
    const pcm = new Int16Array(buf.slice(0, buf.byteLength & ~1));
    const f = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) f[i] = pcm[i]! / 32768;
    const ab = p.ctx.createBuffer(1, f.length, p.rate);
    ab.copyToChannel(f, 0);
    const src = p.ctx.createBufferSource();
    src.buffer = ab; src.connect(p.ctx.destination);
    const at = Math.max(p.next, p.ctx.currentTime + 0.02);
    src.start(at); p.next = at + ab.duration; p.sources.push(src);
    src.onended = () => { p.sources = p.sources.filter((s) => s !== src); };
  }

  function onEvent(e: Record<string, unknown>) {
    switch (e.type) {
      case "ready": { const a = e.audio as { rate: number }; play.current = { ctx: new AudioContext({ sampleRate: a.rate }), next: 0, sources: [], rate: a.rate }; setPhase("live"); break; }
      case "state": setSpeaking(e.state === "speaking"); break;
      case "user": setLines((l) => { const line: Line = { who: "you", text: String(e.text) }; return e.replace && l.at(-1)?.who === "you" ? [...l.slice(0, -1), line] : [...l, line]; }); break;
      case "assistant": setLines((l) => [...l, { who: "ai", text: String(e.text) }]); break;
      case "clear": stopAudio(); break;
      case "handoff": setMessage("Connecting you to a person is not available here. Please call us."); break;
      case "blocked": case "error": setMessage(String(e.message)); setPhase("error"); stop(); break;
    }
  }

  async function begin() {
    const s = startRef.current;
    if (!s) return;
    setPhase("connecting"); setMessage(""); setLines([]);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const ctx = new AudioContext({ sampleRate: 16_000 });
      await ctx.audioWorklet.addModule("/worklets/pcm-capture.js");
      const node = new AudioWorkletNode(ctx, "pcm-capture");
      ctx.createMediaStreamSource(stream).connect(node);
      mic.current = { stream, ctx };
      const socket = new WebSocket(`${s.url}?token=${encodeURIComponent(s.token)}`);
      socket.binaryType = "arraybuffer"; ws.current = socket;
      socket.onopen = () => socket.send(JSON.stringify({ type: "start", language: s.language, voice: s.voice, greeting: true, listen: "close" }));
      socket.onmessage = (m) => (typeof m.data === "string" ? onEvent(JSON.parse(m.data)) : onAudio(m.data as ArrayBuffer));
      socket.onclose = () => { if (ws.current === socket) { stop(); startRef.current = null; setMessage("The call ended. Close this window and open it again to talk once more."); setPhase("error"); } };
      socket.onerror = () => { setMessage("Could not connect. Please try again later."); setPhase("error"); stop(); };
      node.port.onmessage = (m: MessageEvent<ArrayBuffer>) => { if (socket.readyState === 1) socket.send(m.data); };
    } catch (e) {
      stop(); setPhase("error");
      setMessage(e instanceof DOMException && e.name === "NotAllowedError" ? "Microphone access was blocked. Allow it in the browser and try again." : "Could not start the call.");
    }
  }

  return (
    <main style={{ font: "14px system-ui, sans-serif", color: "#e6edfb", background: "#0d1426", minHeight: "100vh", display: "flex", flexDirection: "column", padding: 14, gap: 10 }}>
      <div style={{ flex: 1, overflowY: "auto", display: "grid", gap: 8, alignContent: "start" }} aria-live="polite">
        {phase === "waiting" && <p style={{ opacity: 0.7 }}>Loading…</p>}
        {phase === "ready" && <p style={{ opacity: 0.85 }}>Press the button, allow the microphone, and talk. The call may be recorded and you will be speaking with an AI assistant.</p>}
        {phase === "connecting" && <p style={{ opacity: 0.7 }}>Connecting…</p>}
        {message && <p role="alert" style={{ color: "#ffb4b4" }}>{message}</p>}
        {lines.slice(-8).map((l, i) => <p key={i} style={{ margin: 0, textAlign: l.who === "you" ? "right" : "left" }}><span style={{ display: "inline-block", padding: "6px 10px", borderRadius: 12, background: l.who === "you" ? "#2563eb" : "#1f2c4d", maxWidth: "85%" }}>{l.text}</span></p>)}
      </div>
      {phase === "live" && <p style={{ margin: 0, opacity: 0.7, fontSize: 12 }}>{speaking ? "Assistant speaking…" : "Listening… wear headphones for the best result."}</p>}
      {(phase === "ready") && <button onClick={() => void begin()} style={btn("#2563eb")}>Start talking</button>}
      {(phase === "live" || phase === "connecting") && <button onClick={() => { stop(); setPhase("error"); setMessage("The call ended."); }} style={btn("#c0392b")}>End call</button>}
    </main>
  );
}

const btn = (bg: string) => ({ border: 0, borderRadius: 10, padding: "11px 14px", font: "600 15px system-ui, sans-serif", color: "#fff", background: bg, cursor: "pointer" }) as const;
