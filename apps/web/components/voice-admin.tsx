"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Select } from "./ui/form";
import { Table, Td, Th, Tr } from "./ui/table";
import { PostButton } from "./post-button";
import { HinglishPanel } from "./hinglish-panel";
import { formatDate, titleCase } from "@/lib/utils";
import { T, useLang } from "./t";

interface Profile { id: string; label: string; gender: string; provider: string; status: string; speed: number; pitch: number; hasSample: boolean; donorFirst?: string | null; donorLast?: string | null; donorEmail: string; consentGrantedAt: string; consentPurpose: string; consentWithdrawn: string | null }
const PREVIEW_TEXT = "Hello! Kafi time se baat nahi hui, sab badhiya? Is weekend scene banayein? Batana kab free ho, milte hain!";
interface Consent { id: string; email: string | null; purpose: string; method: string; grantedAt: string; revokedAt: string | null; inUse: boolean }
interface Staff { id: string; email: string }

async function send(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.error ?? "Something went wrong";
}

function useAction() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = (url: string, build: (f: FormData) => unknown) => async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    const err = await send(url, build(new FormData(form)));
    setBusy(false);
    if (err) return setError(err);
    form.reset();
    router.refresh();
  };
  return { error, busy, run };
}

/** Name and gender of a voice, editable in place. Gender decides which built-in Hindi voice is used, so it must be right. */
function VoiceRow({ p }: { p: Profile }) {
  const lang = useLang();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(p.label);
  const [gender, setGender] = useState(p.gender);
  const [speed, setSpeed] = useState(p.speed);
  const [pitch, setPitch] = useState(p.pitch);
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [hinglish, setHinglish] = useState(false);
  const [error, setError] = useState("");
  const donor = [p.donorFirst, p.donorLast].filter(Boolean).join(" ") || p.donorEmail;

  async function save() {
    setBusy(true); setError("");
    const res = await fetch(`/api/voices/${p.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ label, gender, speed, pitch }) });
    setBusy(false);
    if (!res.ok) return setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Could not save");
    setEditing(false);
    router.refresh();
  }

  /** Plays the stored recording the voice was cloned from. */
  async function playOriginal() {
    const res = await fetch(`/api/voices/${p.id}/sample`);
    if (!res.ok) return setError("Could not load the original recording");
    const url = URL.createObjectURL(await res.blob());
    const audio = new Audio(url);
    audio.onended = audio.onerror = () => URL.revokeObjectURL(url);
    await audio.play().catch(() => {});
  }

  /** Saves the stored recording to the computer. */
  async function downloadOriginal() {
    const res = await fetch(`/api/voices/${p.id}/sample`);
    if (!res.ok) return setError("Could not download the original recording");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${p.label}-original.${(blob.type.split("/")[1] || "wav").replace("x-wav", "wav").replace("mpeg", "mp3")}`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Plays a Hinglish sample with the slider values, before anything is saved. */
  async function preview() {
    setPreviewing(true); setError("");
    const res = await fetch("/api/studio/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: PREVIEW_TEXT, voice: `profile:${p.id}`, speed, pitch }) });
    if (!res.ok) { setPreviewing(false); return setError(((await res.json().catch(() => ({}))) as { message?: string; error?: string }).message ?? "Could not make the preview"); }
    const url = URL.createObjectURL(await res.blob());
    const audio = new Audio(url);
    audio.onended = audio.onerror = () => { URL.revokeObjectURL(url); setPreviewing(false); };
    await audio.play().catch(() => setPreviewing(false));
  }

  if (editing) {
    return (
      <Tr>
        <Td><Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} aria-label="Voice name" /></Td>
        <Td><Select value={gender} onChange={(e) => setGender(e.target.value)} aria-label="Gender"><option value="female"><T>Female</T></option><option value="male"><T>Male</T></option></Select></Td>
        <Td>{donor}</Td>
        <Td colSpan={2} className="text-xs text-muted-foreground">
          <label className="grid gap-1"><T>Speed</T> {speed.toFixed(2)}×<input type="range" min={0.8} max={1.25} step={0.01} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Speed" /></label>
          <label className="mt-2 grid gap-1"><T>Pitch</T> {pitch > 0 ? "+" : ""}{pitch.toFixed(1)} <T>semitones</T><input type="range" min={-3} max={3} step={0.1} value={pitch} onChange={(e) => setPitch(Number(e.target.value))} aria-label="Pitch" /></label>
          <p className="mt-2"><T>{error ? <span role="alert" className="text-danger">{error}</span> : "Small changes sound natural; large ones make words harder to understand. Gender picks the built-in Hindi voice, so set it to the speaker's."}</T></p>
        </Td>
        <Td className="text-end whitespace-nowrap">
          <Button size="sm" variant="outline" onClick={() => { setSpeed(1); setPitch(0); }} disabled={speed === 1 && pitch === 0}>Reset</Button>{" "}
          <Button size="sm" variant="outline" onClick={() => void preview()} disabled={previewing}>{previewing ? "Playing…" : "Preview"}</Button>{" "}
          <Button size="sm" onClick={() => void save()} disabled={busy || !label.trim()}>Save</Button>{" "}
          <Button size="sm" variant="outline" onClick={() => { setEditing(false); setLabel(p.label); setGender(p.gender); setSpeed(p.speed); setPitch(p.pitch); setError(""); }}>Cancel</Button>
        </Td>
      </Tr>
    );
  }
  return (
    <>
    <Tr>
      <Td className="font-medium">{p.label}{p.hasSample ? "" : <span className="ms-2 text-xs font-normal text-muted-foreground" title="This voice was cloned before recordings were kept. Clone it again to use it with the realistic open-source engine."><T>no recording saved</T></span>}{p.speed !== 1 || p.pitch !== 0 ? <span className="ms-2 text-xs font-normal text-muted-foreground" title="Speed and pitch applied to this voice">{p.speed.toFixed(2)}× · {p.pitch > 0 ? "+" : ""}{p.pitch.toFixed(1)} <T>st</T></span> : null}</Td><Td>{titleCase(p.gender)}</Td><Td>{donor}</Td>
      <Td className="text-muted-foreground">{formatDate(p.consentGrantedAt, lang)}<T>{p.consentWithdrawn ? " · withdrawn" : ""}</T></Td>
      <Td><Badge tone={p.status === "active" ? "success" : "danger"}>{titleCase(p.status)}</Badge></Td>
      <Td className="text-end whitespace-nowrap">
        {p.status === "active" && p.hasSample && <Button size="sm" variant="outline" onClick={() => void playOriginal()}>Original</Button>}{" "}
        {p.status === "active" && p.hasSample && <Button size="sm" variant="outline" onClick={() => void downloadOriginal()}>Download</Button>}{" "}
        {p.status === "active" && p.provider === "pocket_tts" && <Button size="sm" variant="outline" onClick={() => setHinglish((v) => !v)}>Hinglish</Button>}{" "}
        {p.status === "active" && <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>}{" "}
        {p.status === "active" && <PostButton url={`/api/voices/${p.id}/revoke`} variant="outline" size="sm" confirm={`Revoke "${p.label}"? The clone will be deleted at the provider.`}><T>Revoke</T></PostButton>}{" "}
        <PostButton url={`/api/voices/${p.id}`} method="DELETE" variant="danger" size="sm" confirm={`Delete "${p.label}" for good? The cloned voice and its saved recording are deleted and it disappears from this list. This cannot be undone. Past calls keep their recordings, and the signed consent record is kept as evidence.`}><T>Delete</T></PostButton>
      </Td>
    </Tr>
    {hinglish && <Tr><Td colSpan={6}><HinglishPanel voiceId={p.id} label={p.label} donorName={donor} /></Td></Tr>}
    </>
  );
}

export function VoiceAdmin({ profiles, consents, staff }: { profiles: Profile[]; consents: Consent[]; staff: Staff[] }) {
  const lang = useLang();
  const consentForm = useAction();
  const voiceForm = useAction();
  const usable = consents.filter((c) => !c.revokedAt && !c.inUse);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title="AI voices" description="Cloned staff voices the AI can use. Revoking deletes the clone at the provider." />
        <Table>
          <thead><tr><Th>Voice</Th><Th>Gender</Th><Th>Donor</Th><Th>Consent</Th><Th>Status</Th><Th /></tr></thead>
          <tbody>
            {profiles.map((p) => <VoiceRow key={p.id} p={p} />)}
          </tbody>
        </Table>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="1. Record a staff consent" description="Needed before a voice can be cloned. Upload the signed form to storage first." />
          <CardBody>
            <form className="grid gap-4" onSubmit={consentForm.run("/api/consents", (f) => ({
              subjectType: "staff", subjectId: f.get("staff"), purpose: f.get("purpose"), method: f.get("method"),
              documentUrl: f.get("documentUrl"), grantedAt: new Date(`${f.get("grantedAt")}T00:00:00+05:30`).toISOString(),
            }))}>
              <Field label="Staff member"><Select name="staff" required defaultValue=""><option value="" disabled><T>Choose…</T></option>{staff.map((s) => <option key={s.id} value={s.id}>{s.email}</option>)}</Select></Field>
              <Field label="Purpose and scope"><Input name="purpose" required placeholder="AI voice for inbound and outbound calls" /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Method"><Select name="method" defaultValue="written_signed"><option value="written_signed"><T>Written, signed</T></option><option value="verbal_recorded"><T>Verbal, recorded</T></option></Select></Field>
                <Field label="Date given"><Input name="grantedAt" type="date" required defaultValue={today} max={today} /></Field>
              </div>
              <Field label="Signed document location"><Input name="documentUrl" required placeholder="s3://bucket/consents/name.pdf" /></Field>
              {consentForm.error && <p role="alert" className="text-sm text-danger">{consentForm.error}</p>}
              <Button type="submit" disabled={consentForm.busy}>Save consent</Button>
            </form>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="2. Register a cloned voice" description="Clone it in ElevenLabs first, then paste its voice ID here." />
          <CardBody>
            <form className="grid gap-4" onSubmit={voiceForm.run("/api/voices", (f) => ({
              label: f.get("label"), gender: f.get("gender"), providerVoiceId: f.get("providerVoiceId"), donorUserId: f.get("donor"), consentRecordId: f.get("consent"),
            }))}>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name"><Input name="label" required placeholder="Priya (female)" /></Field>
                <Field label="Gender"><Select name="gender" defaultValue="female"><option value="female"><T>Female</T></option><option value="male"><T>Male</T></option></Select></Field>
              </div>
              <Field label="ElevenLabs voice ID"><Input name="providerVoiceId" required /></Field>
              <Field label="Donor"><Select name="donor" required defaultValue=""><option value="" disabled><T>Choose…</T></option>{staff.map((s) => <option key={s.id} value={s.id}>{s.email}</option>)}</Select></Field>
              <Field label="Consent record" hint={usable.length ? "Only valid, unused consents are listed." : "No unused consent available. Record one first."}>
                <Select name="consent" required defaultValue="" disabled={!usable.length}><option value="" disabled><T>Choose…</T></option>{usable.map((c) => <option key={c.id} value={c.id}>{c.email} · {formatDate(c.grantedAt, lang)}</option>)}</Select>
              </Field>
              {voiceForm.error && <p role="alert" className="text-sm text-danger">{voiceForm.error.replace(/_/g, " ")}</p>}
              <Button type="submit" disabled={voiceForm.busy || !usable.length}>Register voice</Button>
            </form>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Consent records" />
        <Table>
          <thead><tr><Th>Staff</Th><Th>Purpose</Th><Th>Method</Th><Th>Given</Th><Th>Status</Th></tr></thead>
          <tbody>
            {consents.map((c) => (
              <Tr key={c.id}>
                <Td className="font-medium">{c.email ?? "—"}</Td><Td>{c.purpose}</Td><Td>{titleCase(c.method)}</Td><Td>{formatDate(c.grantedAt, lang)}</Td>
                <Td>{c.revokedAt ? <Badge tone="danger">Withdrawn {formatDate(c.revokedAt, lang)}</Badge> : c.inUse ? <Badge tone="success">In use</Badge> : <Badge>Unused</Badge>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
