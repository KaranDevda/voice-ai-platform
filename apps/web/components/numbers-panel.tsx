"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Select } from "./ui/form";
import { formatDateTime, titleCase } from "@/lib/utils";
import { T, useT, useLang } from "./t";

interface Num { id: string; e164: string; label: string | null; capabilities: string[]; carrier: string; trunkId: string | null; assignedAt: string | null }
interface Req { id: string; kind: string; country: string; purpose: string | null; status: string; reviewNote: string | null; createdAt: string }
const TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = { approved: "success", rejected: "danger", pending: "warning" };

/** The organisation's numbers, and a form to ask for another. The platform assigns one after review. */
export function NumbersPanel({ canRequest, numbers, requests }: { canRequest: boolean; numbers: Num[]; requests: Req[] }) {
  const lang = useLang();
  const router = useRouter();
  const t = useT();
  const [kind, setKind] = useState("local");
  const [country, setCountry] = useState("IN");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function ask(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const res = await fetch("/api/numbers/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, country, purpose: purpose || undefined }) });
    setBusy(false);
    const b = await res.json().catch(() => ({}));
    if (!res.ok) return setError(b.message ?? b.issues?.[0]?.message ?? b.error ?? "Could not send the request");
    setPurpose("");
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title={t("Your numbers")} description={t("What each number can be used for today is shown next to it.")} />
        <CardBody>{numbers.length === 0 ? <p className="text-sm text-muted-foreground"><T>No number assigned yet.</T></p> : (
          <ul className="grid gap-3 text-sm">{numbers.map((n) => <li key={n.id} className="grid gap-1">
            <div><span className="font-medium">{n.e164}</span> {n.label && <span className="text-muted-foreground">· {n.label}</span>} <Badge tone="neutral">{n.carrier === "twilio" ? "Twilio" : "Plivo"}</Badge> <span className="text-muted-foreground">· {n.capabilities.join(", ")}</span></div>
            <Usage n={n} />
          </li>)}</ul>
        )}</CardBody>
      </Card>
      {canRequest && (
        <Card>
          <CardHeader title={t("Ask for a number")} description={t("The platform team reviews it and assigns a number. Indian numbers need your KYC first.")} />
          <CardBody>
            <form onSubmit={ask} className="grid gap-3 sm:grid-cols-4">
              <Field label="Type"><Select value={kind} onChange={(e) => setKind(e.target.value)}><option value="local">{t("Local")}</option><option value="tollfree">{t("Toll-free")}</option></Select></Field>
              <Field label="Country" hint="2 letters"><Input value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} maxLength={2} required /></Field>
              <div className="sm:col-span-2"><Field label="What it is for"><Input value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={300} /></Field></div>
              <div><Button type="submit" disabled={busy || country.length !== 2}>{busy ? "Sending…" : "Ask"}</Button></div>
            </form>
            {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
          </CardBody>
        </Card>
      )}
      {requests.length > 0 && (
        <Card>
          <CardHeader title="Requests" />
          <CardBody className="grid gap-2 text-sm">{requests.map((r) => <div key={r.id} className="flex flex-wrap items-center gap-2"><Badge tone={TONE[r.status] ?? "neutral"}>{titleCase(r.status)}</Badge><span>{titleCase(r.kind)} · {r.country} · {formatDateTime(r.createdAt, lang)}{r.purpose ? ` · ${r.purpose}` : ""}</span>{r.reviewNote && <span className="text-muted-foreground">({r.reviewNote})</span>}</div>)}</CardBody>
        </Card>
      )}
    </div>
  );
}

/** What a number can be used for right now. Honest about gaps: the voice service dials through Plivo only, and texts go out from the platform's sender. */
function Usage({ n }: { n: Num }) {
  const t = useT();
  const voice = n.capabilities.includes("voice"), sms = n.capabilities.includes("sms"), plivo = n.carrier !== "twilio";
  const item = (label: string, state: "yes" | "no" | "later", note: string) => <span key={label} title={note} className="inline-flex items-center gap-1"><Badge tone={state === "yes" ? "success" : state === "later" ? "warning" : "neutral"}>{t(label)}</Badge></span>;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span><T>Usable for:</T></span>
      {item("Campaigns", voice && plivo ? "yes" : "no", voice && plivo ? t("Choose it as the caller ID when you create a campaign.") : t("Campaign calls are placed through Plivo numbers only for now."))}
      {item("SMS", sms ? "later" : "no", sms ? t("This number can receive and send texts, but texts currently go out from the platform's sender number.") : t("This number cannot send texts."))}
      {item("Softphone", "later", t("The browser softphone is not available yet; the web dialer practises calls in the browser only."))}
      {n.carrier === "twilio" && n.trunkId && <Badge tone="success">{t("On a SIP trunk")}</Badge>}
    </div>
  );
}
