"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Select, Textarea } from "./ui/form";
import { formatDateTime, titleCase } from "@/lib/utils";
import { T, useLang } from "./t";

interface Sub { id: string; tier: string; status: string; legalName: string; reviewNote: string | null; createdAt: string }
const TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = { approved: "success", rejected: "danger", pending: "warning" };

/** Current verification level, a form to ask for the next one, and the history of requests. */
export function KycPanel({ tier, canSubmit, submissions }: { tier: string; canSubmit: boolean; submissions: Sub[] }) {
  const lang = useLang();
  const router = useRouter();
  const [f, setF] = useState({ tier: tier === "basic" ? "business" : "basic", legalName: "", pan: "", gstin: "", contactName: "", contactPhone: "+91", address: "" });
  const [files, setFiles] = useState<{ pan: File | null; gst: File | null }>({ pan: null, gst: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = submissions.some((s) => s.status === "pending");
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const body = new FormData();
    for (const [k, v] of Object.entries(f)) if (k !== "gstin" || v.trim()) body.set(k, v.trim());
    if (files.pan) body.set("panDoc", files.pan);
    if (files.gst) body.set("gstDoc", files.gst);
    const res = await fetch("/api/kyc", { method: "POST", body });
    setBusy(false);
    const b = await res.json().catch(() => ({}));
    if (!res.ok) return setError(b.message ?? b.issues?.[0]?.message ?? b.error ?? "Could not send the request");
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title="Your level" description="Basic needs the PAN; business also needs the GSTIN." />
        <CardBody><Badge tone={tier === "unverified" ? "warning" : "success"}>{titleCase(tier)}</Badge></CardBody>
      </Card>
      {canSubmit && tier !== "business" && !pending && (
        <Card>
          <CardHeader title="Ask to be verified" description="A person at the platform reviews it. You will see the result here." />
          <CardBody>
            <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
              <Field label="Level"><Select value={f.tier} onChange={(e) => set("tier", e.target.value)}>{tier === "unverified" && <option value="basic"><T>Basic (PAN)</T></option>}<option value="business"><T>Business (PAN + GSTIN)</T></option></Select></Field>
              <Field label="Legal name (as on the PAN)"><Input value={f.legalName} onChange={(e) => set("legalName", e.target.value)} maxLength={120} required /></Field>
              <Field label="PAN" hint="Like ABCDE1234F"><Input value={f.pan} onChange={(e) => set("pan", e.target.value.toUpperCase())} maxLength={10} required /></Field>
              <Field label="GSTIN" hint={f.tier === "business" ? "Required for business" : "Optional"}><Input value={f.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} maxLength={15} required={f.tier === "business"} /></Field>
              <Field label="Contact person"><Input value={f.contactName} onChange={(e) => set("contactName", e.target.value)} maxLength={80} required /></Field>
              <Field label="Contact phone" hint="Like +919876543210"><Input value={f.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} maxLength={20} required /></Field>
              <Field label="PAN card copy" hint="PDF, PNG or JPEG, up to 2 MB"><Input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFiles((x) => ({ ...x, pan: e.target.files?.[0] ?? null }))} required /></Field>
              {f.tier === "business" && <Field label="GST registration certificate" hint="PDF, PNG or JPEG, up to 2 MB"><Input type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFiles((x) => ({ ...x, gst: e.target.files?.[0] ?? null }))} required /></Field>}
              <div className="md:col-span-2"><Field label="Registered address"><Textarea rows={2} value={f.address} onChange={(e) => set("address", e.target.value)} maxLength={300} required /></Field></div>
              <div className="md:col-span-2"><Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send for review"}</Button></div>
            </form>
            {error && <p role="alert" className="mt-3 text-sm text-danger"><T>{error}</T></p>}
          </CardBody>
        </Card>
      )}
      {pending && <Card><CardBody><p className="text-sm"><T>Your request is waiting for review.</T></p></CardBody></Card>}
      {submissions.length > 0 && (
        <Card>
          <CardHeader title="Requests" />
          <CardBody className="grid gap-2 text-sm">
            {submissions.map((s) => <div key={s.id} className="flex flex-wrap items-center gap-2"><Badge tone={TONE[s.status] ?? "neutral"}>{titleCase(s.status)}</Badge><span>{titleCase(s.tier)} · {s.legalName} · {formatDateTime(s.createdAt, lang)}</span>{s.reviewNote && <span className="text-muted-foreground">({s.reviewNote})</span>}</div>)}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
