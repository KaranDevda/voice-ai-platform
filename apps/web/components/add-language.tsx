"use client";
import { Check, Download, Languages, Loader2, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { apiError } from "@/lib/api-client";
import { clockMs, cn } from "@/lib/utils";
import { HINDI_SCRIPT, HINGLISH_SCRIPT, MIN_CLONE_SECONDS, SCRIPT_SECONDS } from "@/lib/clone-scripts";
import { audioDurationMs, samplesToWav } from "@/lib/wav";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Select } from "./ui/form";
import { Notice } from "./ui/page";
import { Recorder } from "./recorder";
import { T, Tf } from "./t";


interface Voice { id: string; label: string; gender: string; donorName: string }

/** A voice file only works in the language it was made for. This adds Hindi to a voice that has only English. */
export function AddLanguage({ voices, hindiReady, ownVoice = false, unavailableReason, variant = "hindi" }: { voices: Voice[]; hindiReady: boolean; ownVoice?: boolean; unavailableReason: string; variant?: "hindi" | "hinglish" }) {
  const hl = variant === "hinglish";
  const word = hl ? "Hinglish" : "Hindi";
  const [voice, setVoice] = useState(voices[0]?.id ?? "");
  const [sample, setSample] = useState<{ file: File; url: string; ms: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [kept, setKept] = useState<{ url: string; name: string } | null>(null);

  const pick = (file: File, ms: number | null) => { if (sample) URL.revokeObjectURL(sample.url); setSample({ file, url: URL.createObjectURL(file), ms }); setDone(""); };
  const chosen = voices.find((v) => v.id === voice);

  async function add() {
    if (!sample || !voice) return;
    setBusy(true); setError(""); setDone("");
    try {
      const form = new FormData();
      form.set("language", "hi");
      form.set("sample", await samplesToWav([sample.file]));
      const res = await fetch(`/api/studio/voices/${voice}/language`, { method: "POST", body: form });
      if (!res.ok) { const e = await apiError(res); return setError(e.hint ? `${e.message} ${e.hint}` : e.message); }
      setDone(hl ? `${chosen?.label ?? "The voice"} can now speak Hinglish in their own voice. The server did not keep the recording: download it below.` : `${chosen?.label ?? "The voice"} can now speak Hindi and Hinglish in their own voice. The server did not keep the recording: download it below.`);
      setKept({ url: sample.url, name: `${chosen?.label ?? "voice"}-${hl ? "hinglish" : "hindi"}.${(sample.file.name.split(".").pop() || "wav").toLowerCase()}` }); setSample(null);
    } catch (e) {
      setError(e instanceof Error && e.message.startsWith("The recording") ? e.message : "Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title={hl ? "Add Hinglish to an existing voice" : "Add Hindi to an existing voice"} description={hl ? "Record the same person reading the Hinglish script so the voice can speak Hinglish in their own voice. The existing consent covers it. Hindi and Hinglish share one voice file, so a new recording replaces the earlier one." : ownVoice ? "Voices cloned before this existed speak Hindi in a built-in voice. A fresh recording of the same person, any language, lets Hindi and Hinglish be spoken in their own voice. The existing consent covers it." : "A voice made for English cannot speak Hindi until the same person records a short Hindi sample. The existing consent covers it."} />
      <CardBody className="grid gap-4">
        {!hindiReady && <Notice tone="warning">{unavailableReason}</Notice>}
        {!voices.length ? <p className="text-sm text-muted-foreground"><T>There are no active cloned voices yet. Clone one above first.</T></p> : (
          <>
            <Field label="Voice">
              <Select value={voice} onChange={(e) => setVoice(e.target.value)} aria-label={`Voice to add ${word} to`}>
                {voices.map((v) => <option key={v.id} value={v.id}>{v.label} · {v.gender} · {v.donorName}</option>)}
              </Select>
            </Field>
            <div className="rounded-xl bg-muted px-4 py-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground"><T>{chosen?.donorName ? `Ask ${chosen.donorName} to read this aloud, read all of it, about ${SCRIPT_SECONDS.hi} seconds, in a quiet room` : "Read this aloud"}</T></p>
              <p lang={hl ? "hi-Latn" : "hi"} className="whitespace-normal break-words text-[15px] leading-relaxed">{hl ? HINGLISH_SCRIPT : HINDI_SCRIPT}</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Recorder label={`Record ${word} sample`} maxSeconds={90} disabled={busy || !hindiReady} onRecorded={pick} />
              <label className={cn("inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted", (busy || !hindiReady) && "pointer-events-none opacity-50")}>
                <Upload className="h-4 w-4" aria-hidden /><T>Upload a recording</T>
                <input type="file" accept="audio/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void audioDurationMs(f).then((ms) => pick(f, ms)); e.target.value = ""; }} />
              </label>
            </div>
            {sample?.ms && sample.ms < MIN_CLONE_SECONDS * 1000 && <Notice tone="warning"><Tf text="Under {n} seconds the Hindi voice usually sounds thin. Read the whole paragraph." vars={{ n: MIN_CLONE_SECONDS }} /></Notice>}
            {sample && (
              <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                <audio controls src={sample.url} className="h-9 flex-1" />
                {sample.ms ? <span className="text-xs text-muted-foreground">{clockMs(sample.ms)}</span> : null}
                <a href={sample.url} download={`${chosen?.label ?? "voice"}-${hl ? "hinglish" : "hindi"}.${(sample.file.name.split(".").pop() || "wav").toLowerCase()}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary underline"><Download className="h-4 w-4" aria-hidden /><T>Download</T></a>
                <button type="button" onClick={() => { URL.revokeObjectURL(sample.url); setSample(null); }} className="text-muted-foreground hover:text-danger" aria-label="Remove the sample"><Trash2 className="h-4 w-4" /></button>
              </div>
            )}
            {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"><T>{error}</T></p>}
            {done && <p role="status" className="flex items-center gap-2 rounded-lg bg-success-soft px-3 py-2 text-sm text-success"><Check className="h-4 w-4" aria-hidden />{done}</p>}
            {done && kept && <a href={kept.url} download={kept.name} className="text-sm font-medium text-primary underline"><Tf text="Download {name} (the only copy; keep it private)" vars={{ name: kept.name }} /></a>}
            <div><Button onClick={() => void add()} disabled={!sample || busy || !hindiReady}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Languages className="h-4 w-4" aria-hidden />}{hl ? "Add Hinglish voice" : ownVoice ? "Use their own voice for Hindi" : "Add Hindi voice"}</Button></div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
