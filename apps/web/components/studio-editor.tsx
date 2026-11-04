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
type Lang = "en" | "hi" | "hinglish";
const LANGS: Array<[Lang, string]> = [["en", "English"], ["hi", "Hindi"], ["hinglish", "Hinglish"]];
/** Ready-made scripts per language. Hinglish: Hindi words in Devanagari, English words in English letters. */
const SAMPLES: Record<Lang, ReadonlyArray<readonly [string, string]>> = {
  en: [
    ["Greeting", "Hello, thanks for calling Bizfy. This call is recorded. How can I help you today?"],
    ["Callback", "Hi, this is a reminder that we will call you back tomorrow at eleven in the morning. If that time does not suit you, just reply and we will move it."],
    ["Pricing", "Our Business plan starts at four thousand nine hundred ninety nine rupees per month and includes up to ten users, the AI phone assistant, and call tracking."],
  ],
  hi: [
    ["Greeting", "नमस्ते! यह कॉल रिकॉर्ड हो सकती है। मैं आपकी कैसे मदद कर सकता हूँ?"],
    ["Callback", "नमस्ते, यह एक अनुस्मारक है कि हम आपको कल सुबह ग्यारह बजे वापस कॉल करेंगे। अगर यह समय आपके लिए ठीक नहीं है, तो बस जवाब दें, हम इसे बदल देंगे।"],
    ["Pricing", "हमारा बिज़नेस प्लान 4,999 रुपये प्रति माह से शुरू होता है, और इसमें दस उपयोगकर्ता, एआई फोन असिस्टेंट और कॉल ट्रैकिंग शामिल हैं।"],
  ],
  hinglish: [
    ["Greeting", "नमस्ते! यह call record हो सकती है। बताइए, मैं आपकी कैसे help कर सकता हूँ?"],
    ["Callback", "Hello, यह एक reminder है कि हम आपको कल सुबह ग्यारह बजे call back करेंगे। अगर यह time आपके लिए ठीक नहीं है, तो बस reply कर दीजिए।"],
    ["Pricing", "हमारा Business plan 4,999 रुपये प्रति माह से शुरू होता है, और इसमें दस users, AI phone assistant और call tracking शामिल हैं।"],
  ],
};
const HINTS: Record<Lang, string> = {
  en: "",
  hi: "Write Hindi in Devanagari script (नमस्ते). Numbers are spoken as Hindi words.",
  hinglish: "Write Hindi words in Devanagari (मदद) and English words in English letters (help). Hindi words typed in English letters, like \"madad\", are read with an English accent.",
};

interface Result { note: string; url: string; ext: "mp3" | "wav"; bytes: number; ms: number; voice: string; chars: number; assetId: string | null }

export function StudioEditor({ voices, initialVoice, cloningReady }: { voices: VoiceChoice[]; initialVoice?: string; cloningReady: boolean }) {
  // Prefer a cloned voice only when cloning is actually available; otherwise start on a voice that works.
  const fallback = voices.find((v) => v.ref === initialVoice)?.ref ?? (cloningReady ? voices.find((v) => v.group === "cloned" && !v.detail.startsWith("Demo"))?.ref : undefined) ?? "dg:aura-2-thalia-en";
  const [text, setText] = useState("");
  const [lang, setLang] = useState<Lang>("en");
  const [voice, setVoice] = useState(fallback);
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);
  // Voice settings (cloned voices). Untouched, the voice's own saved speed and pitch are used.
  const [speed, setSpeed] = useState(1);
  const [pitch, setPitch] = useState(0);
  const [tuned, setTuned] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const picked = voices.find((v) => v.ref === voice);
  const hindi = /[ऀ-ॿ]/.test(text) || lang !== "en";
  const over = text.length > MAX;
  const needsCloning = picked?.group === "cloned" && !cloningReady;

  async function generate() {
    if (!text.trim() || over || busy) return;
    setBusy(true);
    setError(null);
    const t0 = Date.now();
    try {
      const res = await fetch("/api/studio/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, voice, save, ...(tuned && picked?.group === "cloned" ? { speed, pitch } : {}) }) });
      if (!res.ok) return setError(await apiError(res));
      const blob = await res.blob();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      setResult({ note: decodeURIComponent(res.headers.get("x-voice-note") ?? ""), url: urlRef.current, ext: /wav/i.test(blob.type || res.headers.get("content-type") || "") ? "wav" : "mp3", bytes: blob.size, ms: Date.now() - t0, voice: picked?.name ?? voice, chars: text.length, assetId: res.headers.get("x-asset-id") || null });
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
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Language">
            <span className="text-xs text-muted-foreground">Language:</span>
            {LANGS.map(([key, label]) => (
              <button key={key} type="button" aria-pressed={lang === key} onClick={() => { setLang(key); if (!text.trim() || Object.values(SAMPLES).some((l) => l.some(([, t]) => t === text))) setText(SAMPLES[key][0]![1]); }}
                className={`rounded-full px-3 py-1 text-xs font-medium ${lang === key ? "bg-primary-soft text-primary" : "border border-border text-muted-foreground hover:bg-muted"}`}>{label}</button>
            ))}
          </div>
          {HINTS[lang] && <p className="-mt-2 text-xs text-muted-foreground">{HINTS[lang]}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Try:</span>
            {SAMPLES[lang].map(([label, t]) => (
              <button key={label} type="button" onClick={() => setText(t)} className="rounded-full border border-border px-3 py-1 text-xs hover:bg-muted">{label}</button>
            ))}
          </div>
          {hindi && picked?.group === "stock" && <Notice tone="warning">Stock voices speak English only. For Hindi or Hinglish, choose a cloned voice marked &ldquo;Hindi&rdquo;.</Notice>}
          {hindi && picked?.group === "cloned" && picked.hindi !== false && (picked.hindiOwn
            ? <Notice tone="info">Hindi and Hinglish are changed into {picked.name}&apos;s own voice. This adds about a second per sentence.</Notice>
            : <Notice tone="info">Hindi and Hinglish are spoken by a built-in {picked.gender} Hindi voice, not {picked.name}&apos;s own voice. To use their own voice, open Voice clone, Add Hindi to an existing voice. If {picked.name} is the wrong gender, fix it under Voices &amp; consent, Edit.</Notice>)}
          {hindi && picked?.group === "cloned" && picked.hindi === false && <Notice tone="warning">{picked.name} has no Hindi version yet, so Hindi will be spoken in a default Hindi voice. Add one under Voice clone, &ldquo;Add Hindi to an existing voice&rdquo;.</Notice>}
          <p className="text-xs text-muted-foreground">Emotion tags: put <code>[excited]</code>, <code>[calm]</code>, <code>[sad]</code>, <code>[serious]</code>, <code>[angry]</code>, <code>[slow]</code>, <code>[fast]</code> or <code>[pause]</code> before a sentence (Hindi: <code>[खुश]</code>, <code>[शांत]</code>, <code>[उदास]</code>). It applies until the next tag; <code>[neutral]</code> resets. Tags are never spoken. This changes speed, pitch and pauses a little; it is not acting.</p>
          {needsCloning && <Notice tone="warning">Voice cloning is not set up yet. Pick a stock voice for now.</Notice>}
          {error && (
            <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
              {error.message}{error.hint && <div className="mt-1 text-xs opacity-90">{error.hint}</div>}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" /> Save to Projects</label>
            <Button size="lg" disabled={!text.trim() || over || busy || needsCloning} onClick={() => void generate()}>
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
          <CardBody><Field label="Choose a voice"><VoicePicker voices={voices} value={voice} onChange={setVoice} language={lang} /></Field></CardBody>
        </Card>
        <Card>
          <CardHeader title="Voice settings" description={picked?.group === "cloned" ? (tuned ? "Custom for this audio" : "Using the voice's saved settings") : "Available for cloned voices"} />
          <CardBody className="grid gap-5">
            <label className="grid gap-1 text-sm">
              <span className="flex justify-between font-medium">Speed <span className="font-normal text-muted-foreground">{speed.toFixed(2)}×</span></span>
              <input type="range" min={0.8} max={1.25} step={0.01} value={speed} disabled={picked?.group !== "cloned"} onChange={(e) => { setSpeed(Number(e.target.value)); setTuned(true); }} aria-label="Speed" />
              <span className="flex justify-between text-xs text-muted-foreground"><span>Slower</span><span>Faster</span></span>
            </label>
            <label className="grid gap-1 text-sm">
              <span className="flex justify-between font-medium">Pitch <span className="font-normal text-muted-foreground">{pitch > 0 ? "+" : ""}{pitch.toFixed(1)} st</span></span>
              <input type="range" min={-3} max={3} step={0.1} value={pitch} disabled={picked?.group !== "cloned"} onChange={(e) => { setPitch(Number(e.target.value)); setTuned(true); }} aria-label="Pitch" />
              <span className="flex justify-between text-xs text-muted-foreground"><span>Lower</span><span>Higher</span></span>
            </label>
            <button type="button" className="justify-self-start text-xs font-medium text-primary disabled:opacity-40" disabled={!tuned} onClick={() => { setSpeed(1); setPitch(0); setTuned(false); }}>Reset to the voice&apos;s saved settings</button>
            <p className="text-xs text-muted-foreground">Small changes sound natural; large ones make words harder to understand. Set a voice&apos;s permanent values on Voices &amp; consent.</p>
          </CardBody>
        </Card>
        {result ? (
          <Card>
            <CardHeader title="Result" description={`${result.voice} · ${result.chars.toLocaleString()} characters`} />
            <CardBody className="grid gap-3">
              <WaveformPlayer src={result.url} />
              {result.note && <p role="status" className="text-xs text-muted-foreground">{result.note}</p>}
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge>{formatBytes(result.bytes)}</Badge><Badge>{(result.ms / 1000).toFixed(1)}s to generate</Badge>
                {result.assetId && <Link href={`/projects/${result.assetId}`} className="inline-flex items-center gap-1 text-primary hover:underline"><FolderOpen className="h-3.5 w-3.5" aria-hidden />Saved to Projects</Link>}
              </div>
              <a href={result.url} download={`speech.${result.ext}`} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border text-sm font-medium hover:bg-muted"><Download className="h-4 w-4" aria-hidden />Download {result.ext.toUpperCase()}</a>
            </CardBody>
          </Card>
        ) : (
          <Card><CardBody className="flex items-start gap-3 text-sm text-muted-foreground"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />Your generated audio will appear here, ready to play and download.</CardBody></Card>
        )}
      </div>
    </div>
  );
}
