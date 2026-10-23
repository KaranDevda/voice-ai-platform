"use client";
import { Check, Copy, Download, FileAudio, FolderOpen, Loader2, Search, Upload, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { activeLine, speakerName, toPlainText, toSrt, type TranscriptLine } from "@voiceai/shared";
import { apiError } from "@/lib/api-client";
import { clockMs, cn, formatBytes } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Select } from "./ui/form";
import { Recorder } from "./recorder";
import { WaveformPlayer, type PlayerHandle } from "./waveform-player";

interface Result { text: string; durationS: number; language?: string; segments: TranscriptLine[]; assetId: string | null; latencyMs: number }
const SPEAKER_COLORS = ["text-primary", "text-info", "text-success", "text-warning"];

function download(name: string, mime: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TranscribeWorkspace() {
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [language, setLanguage] = useState("auto");
  const [diarize, setDiarize] = useState(true);
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [now, setNow] = useState(0);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [drag, setDrag] = useState(false);
  const player = useRef<PlayerHandle | null>(null);
  const activeRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const choose = (f: File | null) => {
    setResult(null); setError(null); setFile(f);
    setUrl((old) => { if (old) URL.revokeObjectURL(old); return f ? URL.createObjectURL(f) : null; });
  };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) choose(f); };

  async function run() {
    if (!file || busy) return;
    setBusy(true); setError(null); setResult(null);
    const form = new FormData();
    form.set("file", file); form.set("language", language); form.set("diarize", String(diarize)); form.set("save", String(save)); form.set("title", file.name.replace(/\.[^.]+$/, ""));
    try {
      const res = await fetch("/api/studio/transcribe", { method: "POST", body: form });
      if (!res.ok) return setError(await apiError(res));
      setResult(await res.json());
    } catch {
      setError({ message: "Could not reach the server. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  const lines = result?.segments ?? [];
  const active = activeLine(lines, now);
  const q = query.trim().toLowerCase();
  const matches = q ? lines.filter((l) => l.text.toLowerCase().includes(q)).length : 0;
  useEffect(() => { activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [active]);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="grid content-start gap-6">
        <Card>
          <CardHeader title="Audio" description="Upload a file or record from your microphone" />
          <CardBody className="grid gap-4">
            <label
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={onDrop}
              className={cn("flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center text-sm transition-colors", drag ? "border-primary bg-primary-soft" : "border-border hover:bg-muted/50")}
            >
              <Upload className="h-6 w-6 text-muted-foreground" aria-hidden />
              <span className="font-medium">Drop an audio file here, or click to browse</span>
              <span className="text-xs text-muted-foreground">MP3, WAV, M4A, WebM, OGG, FLAC · up to 25 MB</span>
              <input type="file" accept="audio/*,video/mp4,video/webm,.m4a,.flac,.ogg,.opus" className="sr-only" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
            </label>
            <Recorder label="Record" onRecorded={(f) => choose(f)} />
            {file && (
              <div className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2 text-sm">
                <FileAudio className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{file.name}</div><div className="text-xs text-muted-foreground">{formatBytes(file.size)}</div></div>
                <button type="button" aria-label="Remove file" onClick={() => choose(null)} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Options" />
          <CardBody className="grid gap-4">
            <Field label="Language" hint="“English and Hindi mixed” handles Hinglish calls.">
              <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
                <option value="auto">Detect automatically</option><option value="en">English</option><option value="hi">Hindi</option><option value="multi">English and Hindi mixed</option>
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={diarize} onChange={(e) => setDiarize(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" /> Label different speakers</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" /> Save to Projects</label>
            <Button size="lg" disabled={!file || busy} onClick={() => void run()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}{busy ? "Transcribing…" : "Transcribe"}
            </Button>
            {error && <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">{error.message}{error.hint && <div className="mt-1 text-xs opacity-90">{error.hint}</div>}</div>}
          </CardBody>
        </Card>
      </div>

      <Card className="lg:col-span-2">
        <CardHeader
          title="Transcript"
          description={result ? `${lines.length} segment${lines.length === 1 ? "" : "s"} · ${clockMs(result.durationS * 1000)}` : undefined}
          action={result && (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {result.language && <Badge>{result.language}</Badge>}<Badge>{(result.latencyMs / 1000).toFixed(1)}s</Badge>
              {result.assetId && <Link href={`/projects/${result.assetId}`} className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><FolderOpen className="h-3.5 w-3.5" aria-hidden />Saved</Link>}
            </div>
          )}
        />
        <CardBody className="grid gap-4">
          {url && <WaveformPlayer src={url} controllerRef={player} onTime={setNow} />}
          {!result && !busy && <p className="py-10 text-center text-sm text-muted-foreground">{file ? "Press Transcribe to turn this audio into text." : "Add audio on the left to get started."}</p>}
          {busy && <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Listening to the recording…</div>}
          {result && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-48 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the transcript" aria-label="Search the transcript" className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm" />
                </div>
                {q && <span className="text-xs text-muted-foreground">{matches} match{matches === 1 ? "" : "es"}</span>}
                <Button variant="outline" size="sm" onClick={async () => { await navigator.clipboard.writeText(toPlainText(lines)); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                  {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{copied ? "Copied" : "Copy"}
                </Button>
                <Button variant="outline" size="sm" onClick={() => download("transcript.txt", "text/plain", toPlainText(lines))}><Download className="h-4 w-4" aria-hidden />TXT</Button>
                <Button variant="outline" size="sm" onClick={() => download("transcript.srt", "application/x-subrip", toSrt(lines))}><Download className="h-4 w-4" aria-hidden />SRT</Button>
                <Button variant="outline" size="sm" onClick={() => download("transcript.json", "application/json", JSON.stringify(result, null, 2))}><Download className="h-4 w-4" aria-hidden />JSON</Button>
              </div>
              {lines.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No speech was detected in this audio.</p> : (
                <ol className="grid max-h-[28rem] gap-1 overflow-y-auto pr-1">
                  {lines.map((l, i) => {
                    const hit = q && l.text.toLowerCase().includes(q);
                    return (
                      <li key={i} ref={i === active ? activeRef : undefined}>
                        <button type="button" onClick={() => player.current?.seek(l.startMs)}
                          className={cn("flex w-full gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-muted", i === active && "bg-primary-soft", hit && "ring-1 ring-warning")}>
                          <span className="w-11 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">{clockMs(l.startMs)}</span>
                          <span className="min-w-0 flex-1">
                            {new Set(lines.map((x) => x.speaker)).size > 1 && <span className={cn("mr-2 text-xs font-semibold", SPEAKER_COLORS[l.speaker % SPEAKER_COLORS.length])}>{speakerName(l.speaker)}</span>}
                            {l.text}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
