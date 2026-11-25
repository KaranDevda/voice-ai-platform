"use client";
import { Check, Download, Languages, Loader2, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { apiError } from "@/lib/api-client";
import { clockMs, cn } from "@/lib/utils";
import { HINGLISH_SCRIPT, MIN_CLONE_SECONDS, SCRIPT_SECONDS } from "@/lib/clone-scripts";
import { audioDurationMs, samplesToWav } from "@/lib/wav";
import { Button } from "./ui/button";
import { Recorder } from "./recorder";
import { T } from "./t";

/**
 * Per-voice Hinglish section. Hindi and Hinglish share one voice file on the server (language "hi"),
 * so this records a Hinglish sample and sends it to the same endpoint the Hindi form uses.
 */
export function HinglishPanel({ voiceId, label, donorName }: { voiceId: string; label: string; donorName: string }) {
  const [sample, setSample] = useState<{ file: File; url: string; ms: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [kept, setKept] = useState<{ url: string; name: string } | null>(null);

  const pick = (file: File, ms: number | null) => { if (sample) URL.revokeObjectURL(sample.url); setSample({ file, url: URL.createObjectURL(file), ms }); setDone(""); };

  async function add() {
    if (!sample) return;
    setBusy(true); setError(""); setDone("");
    try {
      const form = new FormData();
      form.set("language", "hi");
      form.set("sample", await samplesToWav([sample.file]));
      const res = await fetch(`/api/studio/voices/${voiceId}/language`, { method: "POST", body: form });
      if (!res.ok) { const e = await apiError(res); return setError(e.hint ? `${e.message} ${e.hint}` : e.message); }
      setDone(`${label} can now speak Hinglish in their own voice.`);
      setKept({ url: sample.url, name: `${label}-hinglish.${(sample.file.name.split(".").pop() || "wav").toLowerCase()}` });
      setSample(null);
    } catch (e) {
      setError(e instanceof Error && e.message.startsWith("The recording") ? e.message : "Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid max-w-3xl gap-3 whitespace-normal py-2">
      <p className="text-sm font-medium"><T>Add Hinglish voice</T> · {label}</p>
      <div className="whitespace-normal rounded-xl bg-muted px-4 py-3">
        <p className="mb-1 text-xs font-medium text-muted-foreground"><T>{`Ask ${donorName} to read this aloud, all of it, about ${SCRIPT_SECONDS.hinglish} seconds, in a quiet room`}</T></p>
        <p lang="hi-Latn" className="whitespace-normal break-words text-[15px] leading-relaxed">{HINGLISH_SCRIPT}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Recorder label="Record Hinglish sample" maxSeconds={90} disabled={busy} onRecorded={pick} />
        <label className={cn("inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted", busy && "pointer-events-none opacity-50")}>
          <Upload className="h-4 w-4" aria-hidden /><T>Upload a recording</T>
          <input type="file" accept="audio/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void audioDurationMs(f).then((ms) => pick(f, ms)); e.target.value = ""; }} />
        </label>
      </div>
      {sample?.ms && sample.ms < MIN_CLONE_SECONDS * 1000 ? <p className="text-sm text-warning"><T>Under 30 seconds the voice usually sounds thin. Read the whole paragraph.</T></p> : null}
      {sample && (
        <div className="flex items-center gap-3 rounded-lg border border-border p-3">
          <audio controls src={sample.url} className="h-9 flex-1" />
          {sample.ms ? <span className="text-xs text-muted-foreground">{clockMs(sample.ms)}</span> : null}
          <a href={sample.url} download={`${label}-hinglish.${(sample.file.name.split(".").pop() || "wav").toLowerCase()}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary underline"><Download className="h-4 w-4" aria-hidden /><T>Download</T></a>
          <button type="button" onClick={() => { URL.revokeObjectURL(sample.url); setSample(null); }} className="text-muted-foreground hover:text-danger" aria-label="Remove the sample"><Trash2 className="h-4 w-4" /></button>
        </div>
      )}
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"><T>{error}</T></p>}
      {done && <p role="status" className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2 text-sm text-success"><Check className="h-4 w-4" aria-hidden />{done}</p>}
      {done && kept && <a href={kept.url} download={kept.name} className="inline-flex items-center gap-1 text-sm font-medium text-primary underline"><Download className="h-4 w-4" aria-hidden />Download {kept.name} (the only copy; keep it private)</a>}
      <div><Button size="sm" onClick={() => void add()} disabled={!sample || busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Languages className="h-4 w-4" aria-hidden />}Add Hinglish voice</Button></div>
    </div>
  );
}
