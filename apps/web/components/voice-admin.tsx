"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Select } from "./ui/form";
import { Table, Td, Th, Tr } from "./ui/table";
import { PostButton } from "./post-button";
import { formatDate, titleCase } from "@/lib/utils";

interface Profile { id: string; label: string; gender: string; provider: string; status: string; donorEmail: string; consentGrantedAt: string; consentPurpose: string; consentWithdrawn: string | null }
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

export function VoiceAdmin({ profiles, consents, staff }: { profiles: Profile[]; consents: Consent[]; staff: Staff[] }) {
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
            {profiles.map((p) => (
              <Tr key={p.id}>
                <Td className="font-medium">{p.label}</Td><Td>{titleCase(p.gender)}</Td><Td>{p.donorEmail}</Td>
                <Td className="text-muted-foreground">{formatDate(p.consentGrantedAt)}{p.consentWithdrawn ? " · withdrawn" : ""}</Td>
                <Td><Badge tone={p.status === "active" ? "success" : "danger"}>{titleCase(p.status)}</Badge></Td>
                <Td className="text-right">{p.status === "active" && <PostButton url={`/api/voices/${p.id}/revoke`} variant="outline" size="sm" confirm={`Revoke "${p.label}"? The clone will be deleted at the provider.`}>Revoke</PostButton>}</Td>
              </Tr>
            ))}
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
              <Field label="Staff member"><Select name="staff" required defaultValue=""><option value="" disabled>Choose…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.email}</option>)}</Select></Field>
              <Field label="Purpose and scope"><Input name="purpose" required placeholder="AI voice for inbound and outbound calls" /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Method"><Select name="method" defaultValue="written_signed"><option value="written_signed">Written, signed</option><option value="verbal_recorded">Verbal, recorded</option></Select></Field>
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
                <Field label="Gender"><Select name="gender" defaultValue="female"><option value="female">Female</option><option value="male">Male</option></Select></Field>
              </div>
              <Field label="ElevenLabs voice ID"><Input name="providerVoiceId" required /></Field>
              <Field label="Donor"><Select name="donor" required defaultValue=""><option value="" disabled>Choose…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.email}</option>)}</Select></Field>
              <Field label="Consent record" hint={usable.length ? "Only valid, unused consents are listed." : "No unused consent available. Record one first."}>
                <Select name="consent" required defaultValue="" disabled={!usable.length}><option value="" disabled>Choose…</option>{usable.map((c) => <option key={c.id} value={c.id}>{c.email} · {formatDate(c.grantedAt)}</option>)}</Select>
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
                <Td className="font-medium">{c.email ?? "—"}</Td><Td>{c.purpose}</Td><Td>{titleCase(c.method)}</Td><Td>{formatDate(c.grantedAt)}</Td>
                <Td>{c.revokedAt ? <Badge tone="danger">Withdrawn {formatDate(c.revokedAt)}</Badge> : c.inUse ? <Badge tone="success">In use</Badge> : <Badge>Unused</Badge>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
