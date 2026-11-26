"use client";
import { ImagePlus, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AvatarStream, type AvatarStats } from "@/lib/avatar-stream";
import { T } from "./t";

const K = { link: "voiceai.avatar.link", photo: "voiceai.avatar.photo", delay: "voiceai.avatar.delay" };
const read = (k: string) => { try { return localStorage.getItem(k) ?? ""; } catch { return ""; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private window or storage full */ } };

/**
 * A real person's face from one photo, speaking the AI's voice as live video (MuseTalk on a GPU, streamed back frame by frame).
 * The photo is sent to your own avatar server (the Colab notebook) and nowhere else.
 */
export function AvatarVideo({ onStream }: { onStream: (s: AvatarStream | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<AvatarStream | null>(null);
  const [link, setLink] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [delay, setDelay] = useState(1.3);
  const [status, setStatus] = useState<"setup" | "connecting" | "ready" | "error">("setup");
  const [message, setMessage] = useState("");
  const [stats, setStats] = useState<AvatarStats | null>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    setLink(read(K.link));
    const d = Number(read(K.delay)); if (d >= 0.6 && d <= 3) setDelay(d);
    const p = read(K.photo);
    if (p.startsWith("data:")) void fetch(p).then((r) => r.blob()).then((b) => { setPhoto(b); setPreview(p); });
  }, []);
  useEffect(() => { if (stream.current) stream.current.delay = delay; write(K.delay, String(delay)); }, [delay]);

  // Connect (or reconnect) whenever there is both a link and a photo.
  useEffect(() => {
    const el = canvas.current;
    if (!el || !photo || !/^https?:\/\//.test(link.trim())) { setStatus("setup"); return; }
    const ctl = new AbortController(); let dead = false;
    setStatus("connecting"); setMessage(""); setStats(null);
    AvatarStream.connect(link, photo, el, ctl.signal).then((s) => {
      if (dead) { s.destroy(); return; }
      s.delay = delay; s.onStats = setStats; stream.current = s; onStream(s); setStatus("ready");
    }).catch((e) => { if (!dead) { setStatus("error"); setMessage(e instanceof Error ? e.message : "The avatar could not start."); } });
    return () => { dead = true; ctl.abort(); stream.current?.destroy(); stream.current = null; onStream(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link, photo, tries]);

  function choose(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) { setStatus("error"); setMessage("Choose a photo (JPG or PNG)."); return; }
    const r = new FileReader();
    r.onload = () => { const url = String(r.result); if (url.length < 3_000_000) write(K.photo, url); setPreview(url); setPhoto(file); };
    r.readAsDataURL(file);
  }

  const shown = status === "ready";
  return (
    <div className="grid gap-3">
      <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-muted">
        {preview && !shown && /* eslint-disable-next-line @next/next/no-img-element */ <img src={preview} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        <canvas ref={canvas} className={`absolute inset-0 h-full w-full object-cover ${shown ? "" : "invisible"}`} aria-label="Live talking avatar" />
        {status !== "ready" && (
          <div className="absolute inset-0 grid place-items-center bg-background/55 p-4 text-center text-sm">
            {status === "connecting" ? <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /><T>Preparing the face on the GPU…</T></span>
              : <T>{status === "error" ? message : !link.trim() ? "Paste the avatar link from the Colab notebook, then choose a photo." : "Choose a clear, front-facing photo of a face."}</T>}
          </div>
        )}
      </div>
      <input value={link} onChange={(e) => { setLink(e.target.value); write(K.link, e.target.value); }} placeholder="Avatar link (https://….trycloudflare.com/…)"
        className="w-full rounded-lg border border-border bg-card px-3 py-1.5 text-sm" aria-label="Avatar link" spellCheck={false} />
      <div className="flex gap-2">
        <label className="inline-flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted">
          <ImagePlus className="h-4 w-4" aria-hidden /><T>{photo ? "Change photo" : "Choose photo"}</T>
          <input type="file" accept="image/*" className="sr-only" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {status === "error" && <button type="button" onClick={() => setTries((n) => n + 1)} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"><T>Retry</T></button>}
      </div>
      <label className="grid gap-1 text-xs text-muted-foreground">
        <span><T>Lip-sync delay</T>: {delay.toFixed(1)} s <T>(lower is faster; raise it if the mouth is late)</T></span>
        <input type="range" min={0.6} max={3} step={0.1} value={delay} onChange={(e) => setDelay(Number(e.target.value))} />
      </label>
      {stats && <p className="text-xs text-muted-foreground">{stats.audioMs} ms of speech drawn in {stats.renderMs} ms{stats.firstFrameMs !== null ? ` · first frame after ${stats.firstFrameMs} ms` : ""}{stats.late ? ` · ${stats.late} late frames` : ""}</p>}
      <p className="text-xs text-muted-foreground"><T>The photo is sent only to your avatar server.</T></p>
    </div>
  );
}
