"use client";
import { Download, FolderOpen, Loader2, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { apiError } from "@/lib/api-client";
import { formatBytes } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field } from "./ui/form";
import { Notice } from "./ui/page";
import { VoicePicker, type VoiceChoice } from "./voice-picker";
import { WaveformPlayer } from "./waveform-player";

const MAX = 10_000;
const SAMPLES = [
  ["Greeting", "Hello, thanks for calling Bizfy. You are speaking with an AI assistant, and this call is recorded. How can I help you today?"],
  ["Callback", "Hi, this is a reminder that we will call you back tomorrow at eleven in the morning. If that time does not suit you, just reply and we will move it."],
  ["Pricing", "Our Business plan starts at four thousand nine hundred ninety nine rupees per month and includes up to ten users, the AI phone assistant, and call tracking."],
] as const;

interface Result { url: string; bytes: number; ms: number; voice: string; chars: number; assetId: string | null }

export function StudioEditor({ voices, initialVoice, elevenConfigured }: { voices: VoiceChoice[]; initialVoice?: string; elevenConfigured: boolean }) {
  // Prefer a cloned voice only when cloning is actually available; otherwise start on a voice that works.
  const fallback = voices.find((v) => v.ref === initialVoice)?.ref ?? (elevenConfigured ? voices.find((v) => v.group === "cloned")?.ref : undefined) ?? "dg:aura-2-thalia-en";
  const [text, setText] = useState("");
  const [voice, setVoice] = useState(fallback);
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const picked = voices.find((v) => v.ref === voice);
  const hindi = /[ऀ-ॿ]/.test(text);
  const over = text.length > MAX;
  const needsEleven = picked?.group === "cloned" && !elevenConfigured;

  async function generate() {
    if (!text.trim() || over || busy) return;
    setBusy(true);
    setError(null);
    const t0 = Date.now();
    try {
      const res = await fetch("/api/studio/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice, save }) });
      if (!res.ok) return setError(await apiError(res));
      const blob = await res.blob();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      setResult({ url: urlRef.current, bytes: blob.size, ms: Date.now() - t0, voice: picked?.name ?? voice, chars: text.length, assetId: res.headers.get("x-asset-id") || null });
    } catch {
      setError({ message: "Could not reach the server. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader title="Script" description="Type or paste what the voice should say" action={<span className={over ? "text-xs text-danger" : "text-xs text-muted-foreground"}>{text.length.toLocaleString()} / {MAX.toLocaleString()}</span>} />
        <CardBody className="grid gap-4">
          <label className="sr-only" htmlFor="script">Script</label>
          <textarea
            id="script"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void generate(); }}
            rows={9}
            placeholder="Type what you want the voice to say…"
            className="w-full resize-y rounded-xl border border-border bg-background px-4 py-3 text-[15px] leading-relaxed placeholder:text-muted-foreground focus:border-primary"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Try:</span>
            {SAMPLES.map(([label, t]) => (
              <button key={label} type="button" onClick={() => setText(t)} className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted">{label}</button>
            ))}
          </div>
          {hindi && picked?.group === "stock" && <Notice tone="warning">Stock voices speak English only. For Hindi, choose a cloned ElevenLabs voice.</Notice>}
          {needsEleven && <Notice tone="warning">Cloned voices need an ElevenLabs API key, which is not set yet. Pick a stock voice for now.</Notice>}
          {error && (
            <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
              {error.message}{error.hint && <div className="mt-1 text-xs opacity-90">{error.hint}</div>}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" /> Save to Projects</label>
            <Button size="lg" disabled={!text.trim() || over || busy || needsEleven} onClick={() => void generate()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Wand2 className="h-4 w-4" aria-hidden />}
              {busy ? "Generating…" : "Generate speech"}
              {!busy && <kbd className="ml-1 hidden rounded bg-black/15 px-1.5 text-[10px] sm:inline">⌘↵</kbd>}
            </Button>
          </div>
        </CardBody>
      </Card>

      <div className="grid content-start gap-6">
        <Card>
          <CardHeader title="Voice" />
          <CardBody><Field label="Choose a voice"><VoicePicker voices={voices} value={voice} onChange={setVoice} /></Field></CardBody>
        </Card>
        {result ? (
          <Card>
            <CardHeader title="Result" description={`${result.voice} · ${result.chars.toLocaleString()} characters`} />
            <CardBody className="grid gap-3">
              <WaveformPlayer src={result.url} />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge>{formatBytes(result.bytes)}</Badge><Badge>{(result.ms / 1000).toFixed(1)}s to generate</Badge>
                {result.assetId && <Link href={`/projects/${result.assetId}`} className="inline-flex items-center gap-1 text-primary hover:underline"><FolderOpen className="h-3.5 w-3.5" aria-hidden />Saved to Projects</Link>}
              </div>
              <a href={result.url} download="speech.mp3" className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium hover:bg-muted"><Download className="h-4 w-4" aria-hidden />Download MP3</a>
            </CardBody>
          </Card>
        ) : (
          <Card><CardBody className="flex items-start gap-3 text-sm text-muted-foreground"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />Your generated audio will appear here, ready to play and download.</CardBody></Card>
        )}
      </div>
    </div>
  );
}
