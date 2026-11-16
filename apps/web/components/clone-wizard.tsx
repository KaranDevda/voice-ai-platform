"use client";
import { Check, ChevronRight, Download, Fingerprint, Loader2, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiError } from "@/lib/api-client";
import { clockMs, cn, formatBytes } from "@/lib/utils";
import { ENGLISH_SCRIPT, HINDI_SCRIPT, MIN_CLONE_SECONDS, SCRIPT_SECONDS } from "@/lib/clone-scripts";
import { audioDurationMs, samplesToWav } from "@/lib/wav";
import { Button, buttonClass } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Select } from "./ui/form";
import { Notice } from "./ui/page";
import { Recorder } from "./recorder";

interface Staff { id: string; email: string }
interface Consent { id: string; subjectId: string; purpose: string; grantedAt: string }
interface Sample { file: File; url: string; durationMs: number | null }

const STEPS = ["Consent", "Voice samples", "Create"];

export function CloneWizard({ staff, consents, cloningReady, builtInHindi = false, ownVoiceHindi = false }: { staff: Staff[]; consents: Consent[]; cloningReady: boolean; builtInHindi?: boolean; ownVoiceHindi?: boolean }) {
  const [step, setStep] = useState(0);
  const [donor, setDonor] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [person, setPerson] = useState<{ firstName: string; lastName: string; created: boolean } | null>(null);
  const [consentId, setConsentId] = useState("");
  const [mode, setMode] = useState<"existing" | "new">("new");
  const today = new Date().toISOString().slice(0, 10);
  const [c, setC] = useState({ purpose: "AI voice for inbound and outbound calls", method: "written_signed", date: today, doc: "" });
  const [samples, setSamples] = useState<Sample[]>([]);
  const [hindiSample, setHindiSample] = useState<Sample | null>(null);
  const [label, setLabel] = useState("");
  const [gender, setGender] = useState(""); // chosen on purpose: it decides the built-in Hindi voice
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ id: string; label: string; languages?: string[]; missingLanguages?: string[]; hindiInOwnVoice?: boolean } | null>(null);

  const mine = useMemo(() => consents.filter((x) => x.subjectId === donor), [consents, donor]);
  useEffect(() => { setConsentId(""); setMode(mine.length ? "existing" : "new"); }, [donor, mine.length]);
  useEffect(() => () => samples.forEach((s) => URL.revokeObjectURL(s.url)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const donorName = person ? `${person.firstName} ${person.lastName}` : "";
  const totalMs = samples.reduce((n, s) => n + (s.durationMs ?? 0), 0);
  const addSample = (file: File, durationMs: number | null) => setSamples((l) => (l.length >= 3 ? l : [...l, { file, url: URL.createObjectURL(file), durationMs }]));
  const removeSample = (i: number) => setSamples((l) => { URL.revokeObjectURL(l[i]!.url); return l.filter((_, j) => j !== i); });

  const consentOk = !!donor && (mode === "existing" ? !!consentId : !!c.purpose.trim() && !!c.doc.trim() && !!c.date);

  async function findPerson() {
    setError(""); setBusy(true);
    try {
      const res = await fetch("/api/studio/donors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ firstName: first, lastName: last }) });
      if (!res.ok) return setError((await apiError(res)).message);
      const p = (await res.json()) as { id: string; firstName: string; lastName: string; created: boolean };
      setPerson(p); setDonor(p.id);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    setError("");
    if (step === 0 && mode === "new") {
      setBusy(true);
      const res = await fetch("/api/consents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subjectType: "staff", subjectId: donor, purpose: c.purpose, method: c.method, documentUrl: c.doc, grantedAt: new Date(`${c.date}T00:00:00+05:30`).toISOString() }) });
      setBusy(false);
      if (!res.ok) return setError((await apiError(res)).message);
      setConsentId((await res.json()).id);
      setMode("existing");
    }
    if (step === 0 && !label) setLabel(person?.firstName ?? "");
    setStep((s) => s + 1);
  }

  async function create() {
    setBusy(true); setError("");
    const form = new FormData();
    form.set("label", label); form.set("gender", gender); form.set("donorUserId", donor); form.set("consentRecordId", consentId);
    try {
      // Recordings come in many formats; the voice engine wants one clean WAV.
      form.append("samples", await samplesToWav(samples.map((s) => s.file)));
      if (hindiSample) form.append("samplesHindi", await samplesToWav([hindiSample.file]));
      const res = await fetch("/api/studio/clone", { method: "POST", body: form });
      if (!res.ok) { const e = await apiError(res); return setError(e.hint ? `${e.message} ${e.hint}` : e.message); }
      setDone(await res.json());
    } catch (e) {
      setError(e instanceof Error && e.message.startsWith("The recording") ? e.message : "Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Card><CardBody className="grid justify-items-center gap-4 py-12 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-success-soft text-success"><Check className="h-7 w-7" aria-hidden /></span>
        <div><h2 className="text-xl font-semibold">{done.label}&apos;s voice is ready</h2><p className="mt-1 text-sm text-muted-foreground">The consent is linked, and the recording is kept securely with the voice (only people who manage voices can hear it). You can revoke this voice at any time.</p>
          <div className="mx-auto mt-3 max-w-md rounded-xl border border-border p-4 text-left">
            <div className="text-sm font-semibold">Save your recordings now</div>
            <p className="mb-2 mt-1 text-xs text-muted-foreground">The app keeps one copy with the voice. Keep your own copy somewhere private too: a voice recording is personal data. With them, a better voice model can be tried later without recording again.</p>
            <div className="grid gap-1.5">
              {[...samples.map((smp, i) => ({ smp, name: `${done.label}-english-${i + 1}` })), ...(hindiSample ? [{ smp: hindiSample, name: `${done.label}-hindi` }] : [])].map(({ smp, name }) => (
                <a key={name} href={smp.url} download={`${name}.${(smp.file.name.split(".").pop() || "wav").toLowerCase()}`} className={buttonClass({ variant: "outline", size: "sm" })}>Download {name}</a>
              ))}
            </div>
          </div>
          {done.languages && (
            <div className="mt-3 flex flex-wrap justify-center gap-2 text-sm" aria-label="Languages ready">
              {[["English", done.languages.includes("en")], ["Hindi", done.languages.includes("hi")], ["Hinglish", done.languages.includes("en") && done.languages.includes("hi")]].map(([name, okLang]) => (
                <span key={String(name)} className={cn("inline-flex items-center gap-1 rounded-full px-3 py-1", okLang ? "bg-success-soft text-success" : "bg-muted text-muted-foreground")}>{okLang ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}{name}{okLang ? (name !== "English" ? (done.hindiInOwnVoice ? " (own voice)" : " (built-in voice)") : "") : " (not available)"}</span>
              ))}
            </div>
          )}
          {done.missingLanguages?.length ? <div className="mx-auto mt-3 max-w-md text-left"><Notice tone="warning">The {done.missingLanguages.map((l) => (l === "hi" ? "Hindi" : l)).join(", ")} version could not be created. You can add it later with &ldquo;Add Hindi to an existing voice&rdquo; below.</Notice></div> : null}
        </div>
        <div className="flex gap-2"><Link href={`/studio?voice=${encodeURIComponent(`profile:${done.id}`)}`} className={buttonClass()}>Try it in Studio</Link><Link href="/library" className={buttonClass({ variant: "outline" })}>Voice library</Link></div>
      </CardBody></Card>
    );
  }

  return (
    <div className="grid gap-6">
      {!cloningReady && <Notice tone="warning">Voice cloning is not set up yet. You can prepare the consent and samples, but the final step stays disabled until the voice engine is running (see docs/POCKET_TTS.md).</Notice>}
      <ol className="flex items-center gap-2 text-sm" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span aria-current={i === step ? "step" : undefined} className={cn("grid h-7 w-7 place-items-center rounded-full text-xs font-semibold", i < step ? "bg-success text-primary-foreground" : i === step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{i < step ? <Check className="h-4 w-4" aria-hidden /> : i + 1}</span>
            <span className={i === step ? "font-medium" : "text-muted-foreground"}>{s}</span>
            {i < STEPS.length - 1 && <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card>
          <CardHeader title="Whose voice, and do they consent?" description="A clone is only created with written consent from that person. It names the purpose and their right to withdraw." />
          <CardBody className="grid max-w-2xl gap-4">
            {!donor ? (
              <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); void findPerson(); }}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="First name"><Input value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="off" required maxLength={60} /></Field>
                  <Field label="Last name"><Input value={last} onChange={(e) => setLast(e.target.value)} autoComplete="off" required maxLength={60} /></Field>
                </div>
                <div><Button type="submit" disabled={!first.trim() || !last.trim() || busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Continue</Button></div>
              </form>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-muted px-4 py-3 text-sm">
                <span><span className="font-medium">{donorName}</span>{person?.created ? " (added as a new person)" : " (already on file)"}</span>
                <button type="button" onClick={() => { setDonor(""); setPerson(null); setConsentId(""); }} className="text-primary hover:underline">Change person</button>
              </div>
            )}
            {donor && mine.length > 0 && (
              <div className="flex gap-2" role="radiogroup" aria-label="Consent">
                {(["existing", "new"] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cn("rounded-lg border px-3 py-1.5 text-sm", mode === m ? "border-primary bg-primary-soft text-primary" : "border-border hover:bg-muted")}>{m === "existing" ? "Use a consent on file" : "Record a new consent"}</button>)}
              </div>
            )}
            {donor && mode === "existing" && mine.length > 0 && (
              <Field label="Consent on file"><Select value={consentId} onChange={(e) => setConsentId(e.target.value)}><option value="" disabled>Choose…</option>{mine.map((x) => <option key={x.id} value={x.id}>{x.purpose} · {new Date(x.grantedAt).toLocaleDateString("en-IN")}</option>)}</Select></Field>
            )}
            {donor && mode === "new" && (
              <>
                <Field label="Purpose and scope"><Input value={c.purpose} onChange={(e) => setC({ ...c, purpose: e.target.value })} /></Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Method"><Select value={c.method} onChange={(e) => setC({ ...c, method: e.target.value })}><option value="written_signed">Written, signed</option><option value="verbal_recorded">Verbal, recorded</option></Select></Field>
                  <Field label="Date given"><Input type="date" value={c.date} max={today} onChange={(e) => setC({ ...c, date: e.target.value })} /></Field>
                </div>
                <Field label="Where the signed document is stored" hint="For example s3://your-bucket/consents/name.pdf"><Input value={c.doc} onChange={(e) => setC({ ...c, doc: e.target.value })} /></Field>
              </>
            )}
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            {donor && <div><Button disabled={!consentOk || busy} onClick={() => void next()}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}Continue</Button></div>}
          </CardBody>
        </Card>
      )}

      {step === 1 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Read this aloud" description={`Takes about ${SCRIPT_SECONDS.en} seconds. Read all of it, in a quiet room, at your normal speaking pace.`} />
            <CardBody className="grid gap-4">
              <p className="rounded-xl bg-muted px-4 py-3 text-[15px] leading-relaxed">{ENGLISH_SCRIPT}</p>
              <ul className="list-disc pl-5 text-xs text-muted-foreground"><li>Use the microphone you will always use, a few centimetres away.</li><li>No music, fans or other voices in the background.</li><li>Speak naturally, as you would on a call.</li></ul>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Samples" description={samples.length ? `${samples.length} of 3 · ${totalMs ? clockMs(totalMs) + " recorded" : formatBytes(samples.reduce((n, s) => n + s.file.size, 0))}` : "Record or upload up to 3 clips"} />
            <CardBody className="grid gap-4">
              <Recorder label="Record a sample" maxSeconds={180} disabled={samples.length >= 3} onRecorded={(f, ms) => addSample(f, ms)} />
              <label className={cn("flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border px-4 py-5 text-sm hover:bg-muted/50", samples.length >= 3 && "pointer-events-none opacity-50")}>
                <Upload className="h-4 w-4" aria-hidden />Upload an audio file<input type="file" accept="audio/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void audioDurationMs(f).then((ms) => addSample(f, ms)); e.target.value = ""; }} />
              </label>
              {samples.map((s, i) => (
                <div key={s.url} className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2">
                  <audio controls src={s.url} className="h-9 min-w-0 flex-1" />
                  <a href={s.url} download={s.file.name} aria-label={`Download sample ${i + 1}`} className={buttonClass({ variant: "outline", size: "sm" })}><Download className="h-4 w-4" aria-hidden />Download</a>
                  <button type="button" aria-label={`Remove sample ${i + 1}`} onClick={() => removeSample(i)} className="text-muted-foreground hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              {totalMs > 0 && totalMs < MIN_CLONE_SECONDS * 1000 && <Notice tone="warning">Under {MIN_CLONE_SECONDS} seconds the voice usually sounds thin. Read the whole paragraph, or add another sample.</Notice>}
              <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(0)}>Back</Button><Button disabled={!samples.length} onClick={() => setStep(2)}>Continue</Button></div>
            </CardBody>
          </Card>
          {builtInHindi ? (
            <div className="lg:col-span-2"><Notice tone="info">{ownVoiceHindi ? "One recording is enough. English is spoken in the cloned voice, and Hindi and Hinglish are spoken in a clear Hindi voice that is then changed into this person's own voice, which adds about a second per sentence." : "Hindi and Hinglish are spoken by a built-in Hindi voice (male or female, to match this person), because a cloned Hindi voice from one recording was not clear enough. English is spoken in the cloned voice."}</Notice></div>
          ) : (
          <Card className="lg:col-span-2">
            <CardHeader title="Hindi recording (for Hindi and Hinglish)" description={`The same person reads this in Hindi, about ${SCRIPT_SECONDS.hi} seconds. English and Hinglish need no extra recording: Hinglish uses the English and Hindi voices together.`} />
            <CardBody className="grid gap-4">
              <p lang="hi" className="rounded-xl bg-muted px-4 py-3 text-[15px] leading-relaxed">{HINDI_SCRIPT}</p>
              <div className="flex flex-wrap items-center gap-3">
                <Recorder label="Record Hindi sample" maxSeconds={120} disabled={!!hindiSample} onRecorded={(f, ms) => setHindiSample({ file: f, url: URL.createObjectURL(f), durationMs: ms })} />
                <label className={cn("inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted", hindiSample && "pointer-events-none opacity-50")}>
                  <Upload className="h-4 w-4" aria-hidden />Upload Hindi audio<input type="file" accept="audio/*" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) void audioDurationMs(f).then((ms) => setHindiSample({ file: f, url: URL.createObjectURL(f), durationMs: ms })); e.target.value = ""; }} />
                </label>
              </div>
              {hindiSample?.durationMs && hindiSample.durationMs < MIN_CLONE_SECONDS * 1000 && <Notice tone="warning">Under {MIN_CLONE_SECONDS} seconds the Hindi voice usually sounds thin. Read the whole paragraph.</Notice>}
              {hindiSample && (
                <div className="flex items-center gap-3 rounded-lg bg-muted px-3 py-2">
                  <audio controls src={hindiSample.url} className="h-9 min-w-0 flex-1" />
                  <button type="button" aria-label="Remove the Hindi sample" onClick={() => { URL.revokeObjectURL(hindiSample.url); setHindiSample(null); }} className="text-muted-foreground hover:text-danger"><Trash2 className="h-4 w-4" /></button>
                </div>
              )}
            </CardBody>
          </Card>
          )}
        </div>
      )}

      {step === 2 && (
        <Card>
          <CardHeader title="Name the voice and create it" />
          <CardBody className="grid max-w-2xl gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Voice name"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Priya (female)" /></Field>
              <Field label="Gender"><Select value={gender} onChange={(e) => setGender(e.target.value)}><option value="" disabled>Choose…</option><option value="female">Female</option><option value="male">Male</option></Select></Field>
            </div>
            <dl className="grid gap-1 rounded-xl bg-muted px-4 py-3 text-sm">
              <div className="flex justify-between"><dt className="text-muted-foreground">Donor</dt><dd className="font-medium">{donorName}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Samples</dt><dd className="font-medium">{samples.length}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Consent</dt><dd className="font-medium text-success">On file</dd></div>
            </dl>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />I confirm this person agreed to have their voice cloned for this purpose, and knows they can withdraw consent at any time. The AI will never claim to be them.</label>
            {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button size="lg" disabled={!confirm || !label.trim() || !gender || busy || !cloningReady} onClick={() => void create()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Fingerprint className="h-4 w-4" aria-hidden />}{busy ? "Cloning…" : "Create voice"}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
