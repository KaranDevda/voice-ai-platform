"use client";
import { Mic, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { clockMs, cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { T } from "./t";

const BARS = 24;

/** Records from the microphone and hands back a File. Shows a live level meter while recording. */
export function Recorder({ onRecorded, onStart, maxSeconds = 120, disabled, label = "Record" }: {
  onRecorded: (file: File, durationMs: number) => void;
  /** Fires as soon as the microphone is live (used to interrupt audio that is still playing). */
  onStart?: () => void;
  maxSeconds?: number;
  disabled?: boolean;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "recording">("idle");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0.05));
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef(0);
  const startedAt = useRef(0);
  const ctx = useRef<AudioContext | null>(null);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    void ctx.current?.close().catch(() => {});
    ctx.current = null;
  }, []);
  useEffect(() => cleanup, [cleanup]);

  const stop = useCallback(() => { if (rec.current?.state === "recording") rec.current.stop(); }, []);

  async function start() {
    setError("");
    onStart?.();
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") return setError("This browser cannot record audio. Upload a file instead.");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      stream.current = s;
      const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        const type = r.mimeType || "audio/webm";
        const ext = type.includes("mp4") ? "m4a" : "webm";
        const ms = Date.now() - startedAt.current;
        cleanup();
        setState("idle");
        setLevels(Array(BARS).fill(0.05));
        if (chunks.length) onRecorded(new File(chunks, `recording-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${ext}`, { type }), ms);
      };
      rec.current = r;

      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ac = new Ctx();
      ctx.current = ac;
      const an = ac.createAnalyser();
      an.fftSize = 128;
      ac.createMediaStreamSource(s).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const tick = () => {
        an.getByteFrequencyData(buf);
        setLevels(Array.from({ length: BARS }, (_, i) => Math.max(0.05, (buf[Math.floor((i / BARS) * buf.length * 0.6)] ?? 0) / 255)));
        const secs = (Date.now() - startedAt.current) / 1000;
        setElapsed(secs * 1000);
        if (secs >= maxSeconds) return stop();
        raf.current = requestAnimationFrame(tick);
      };
      startedAt.current = Date.now();
      r.start(250);
      setState("recording");
      tick();
    } catch (e) {
      cleanup();
      setError(e instanceof DOMException && e.name === "NotAllowedError" ? "Microphone access was blocked. Allow it in the browser's address bar and try again." : "Could not start the microphone.");
    }
  }

  const recording = state === "recording";
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-3">
        <Button type="button" variant={recording ? "danger" : "outline"} disabled={disabled} onClick={() => (recording ? stop() : void start())}>
          {recording ? <Square className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
          {recording ? "Stop" : label}
        </Button>
        <div className={cn("flex h-8 flex-1 items-center gap-[2px]", !recording && "opacity-40")} aria-hidden>
          {levels.map((l, i) => <span key={i} className="flex-1 rounded-full bg-wave" style={{ height: `${l * 100}%` }} />)}
        </div>
        <div className="flex w-20 items-center justify-end gap-1.5 text-xs tabular-nums text-muted-foreground">
          {recording && <span className="rec-dot h-2 w-2 rounded-full bg-danger" aria-label="Recording" />}
          {clockMs(elapsed)}
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-danger"><T>{error}</T></p>}
    </div>
  );
}
