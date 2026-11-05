"use client";
import { Download, Pause, Play } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
import { clockMs, cn } from "@/lib/utils";

export interface PlayerHandle { seek(ms: number): void; play(): void }

const BARS = 110;
const FLAT = Array.from({ length: BARS }, (_, i) => 0.18 + 0.1 * Math.abs(Math.sin(i / 5)));

async function peaksOf(buf: ArrayBuffer): Promise<{ peaks: number[]; durationMs: number } | null> {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const audio = await ctx.decodeAudioData(buf.slice(0));
    void ctx.close();
    const data = audio.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / BARS));
    const raw = Array.from({ length: BARS }, (_, i) => {
      let max = 0;
      for (let j = i * step; j < Math.min((i + 1) * step, data.length); j++) max = Math.max(max, Math.abs(data[j]!));
      return max;
    });
    const top = Math.max(...raw, 0.001);
    return { peaks: raw.map((v) => Math.max(0.06, v / top)), durationMs: audio.duration * 1000 };
  } catch {
    return null; // Some browsers cannot decode every format; the player still works with flat bars.
  }
}

/**
 * Audio player with a real waveform. The file is fetched once (so protected recordings are logged once, not
 * twice) and played from memory. With `lazy`, nothing is fetched until the user presses play.
 */
export function WaveformPlayer({ src, lazy = false, controllerRef, onTime, downloadName, className }: {
  src: string;
  lazy?: boolean;
  controllerRef?: MutableRefObject<PlayerHandle | null>;
  onTime?: (ms: number) => void;
  downloadName?: string;
  className?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const objectUrl = useRef<string | null>(null);
  const [peaks, setPeaks] = useState<number[]>(FLAT);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [now, setNow] = useState(0);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");

  const load = useCallback(async (): Promise<boolean> => {
    if (ready) return true;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(src);
      if (!res.ok) throw new Error(res.status === 403 ? "You do not have access to this audio." : res.status === 404 ? "This audio is no longer available." : "Could not load the audio.");
      const blob = await res.blob();
      objectUrl.current = URL.createObjectURL(blob);
      if (audioRef.current) audioRef.current.src = objectUrl.current;
      const decoded = await peaksOf(await blob.arrayBuffer());
      if (decoded) { setPeaks(decoded.peaks); setTotal((t) => t || decoded.durationMs); }
      setReady(true);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the audio.");
      return false;
    } finally {
      setLoading(false);
    }
  }, [src, ready]);

  useEffect(() => {
    setReady(false); setPlaying(false); setNow(0); setTotal(0); setPeaks(FLAT);
    if (!lazy) void load();
    return () => { if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, lazy]);

  const toggle = useCallback(async () => {
    const a = audioRef.current;
    if (!a) return;
    if (!ready && !(await load())) return;
    if (a.paused) await a.play().catch(() => setError("Playback was blocked by the browser."));
    else a.pause();
  }, [ready, load]);

  const seekTo = useCallback((ms: number) => { if (audioRef.current) audioRef.current.currentTime = Math.max(0, ms / 1000); }, []);

  useEffect(() => {
    if (controllerRef) controllerRef.current = { seek: (ms) => { seekTo(ms); void audioRef.current?.play().catch(() => {}); }, play: () => void toggle() };
    return () => { if (controllerRef) controllerRef.current = null; };
  }, [controllerRef, seekTo, toggle]);

  const ratio = total ? Math.min(1, now / total) : 0;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") seekTo(now + 5000);
    else if (e.key === "ArrowLeft") seekTo(now - 5000);
    else if (e.key === " " || e.key === "Enter") { e.preventDefault(); void toggle(); }
  };

  return (
    <div className={cn("w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-muted/40 p-3", className)}>
      <audio
        ref={audioRef}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d) && d > 0) setTotal(d * 1000); }}
        onTimeUpdate={(e) => { const ms = e.currentTarget.currentTime * 1000; setNow(ms); onTime?.(ms); }}
      />
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={() => void toggle()}
          disabled={loading}
          aria-label={playing ? "Pause" : "Play"}
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="ml-0.5 h-4 w-4" aria-hidden />}
        </button>
        <div
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(total / 1000)}
          aria-valuenow={Math.round(now / 1000)}
          onKeyDown={onKey}
          onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (ready && total) seekTo(((e.clientX - r.left) / r.width) * total); else void toggle(); }}
          className="flex h-12 min-w-0 flex-1 cursor-pointer items-center gap-px overflow-hidden"
        >
          {peaks.map((p, i) => (
            <span key={i} className="min-w-0 flex-1 rounded-full" style={{ height: `${(p * 100).toFixed(2)}%`, /* rounded: Math.sin differs in the last digits between the server and the browser, which React reports as a mismatch */ background: i / BARS <= ratio && ready ? "var(--wave)" : "var(--wave-dim)" }} />
          ))}
        </div>
        <div className="w-[5.25rem] shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
          {loading ? "Loading…" : `${clockMs(now)} / ${total ? clockMs(total) : "--:--"}`}
        </div>
        {downloadName && ready && objectUrl.current && (
          <a href={objectUrl.current} download={downloadName} aria-label="Download audio" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground">
            <Download className="h-4 w-4" aria-hidden />
          </a>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}
