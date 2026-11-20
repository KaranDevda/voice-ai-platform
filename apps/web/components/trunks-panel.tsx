"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Select } from "./ui/form";
import { T, useT, useLang } from "./t";
import { formatDateTime } from "@/lib/utils";

type Status = "ok" | "degraded" | "down";
interface Check { name: string; status: string; detail: string }
interface Trunk { id: string; name: string; terminationDomain: string | null; originationUrls: string[]; lastHealthStatus: Status | null; lastHealthJson: { checks: Check[] } | null; lastCheckedAt: string | null }
interface TwilioNumber { id: string; e164: string; trunkId: string | null }
const TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { ok: "success", degraded: "warning", down: "danger" };
const LABEL: Record<string, string> = { ok: "Healthy", degraded: "Degraded", down: "Down" };

/** Bring-your-own-carrier SIP trunks (Twilio only): your carrier or PBX sends and receives calls through Twilio, with a health check. */
export function TrunksPanel({ canManage, trunks, numbers }: { canManage: boolean; trunks: Trunk[]; numbers: TwilioNumber[] }) {
  const lang = useLang();
  const router = useRouter();
  const t = useT();
  const [name, setName] = useState("");
  const [originationUrl, setOriginationUrl] = useState("");
  const [allowIp, setAllowIp] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [pick, setPick] = useState<Record<string, string>>({});

  async function call(key: string, url: string, init: RequestInit, after?: () => void) {
    setBusy(key); setError("");
    try {
      const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) { setError(b.message ?? b.issues?.[0]?.message ?? b.hint ?? b.error ?? "Request failed"); return; }
      after?.(); router.refresh();
    } catch { setError("Could not reach the server. Try again."); }
    finally { setBusy(""); }
  }
  function create(e: FormEvent) {
    e.preventDefault();
    void call("create", "/api/trunks", { method: "POST", body: JSON.stringify({ name, originationUrl, ...(allowIp.trim() ? { allowIp: allowIp.trim() } : {}), ...(username.trim() ? { credential: { username: username.trim(), password } } : {}) }) },
      () => { setName(""); setOriginationUrl(""); setAllowIp(""); setUsername(""); setPassword(""); });
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader title={t("SIP trunks (bring your own carrier)")} description={t("Connect your own carrier or PBX. Calls to your numbers are sent to your SIP address; your PBX sends outbound calls to the trunk's termination domain.")} />
        <CardBody className="grid gap-4">
          {trunks.length === 0 && <p className="text-sm text-muted-foreground"><T>No SIP trunk yet.</T></p>}
          {trunks.map((tr) => {
            const mine = numbers.filter((n) => n.trunkId === tr.id), free = numbers.filter((n) => !n.trunkId);
            return (
              <div key={tr.id} className="grid gap-2 rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{tr.name}</span>
                  {tr.lastHealthStatus ? <Badge tone={TONE[tr.lastHealthStatus] ?? "neutral"}>{t(LABEL[tr.lastHealthStatus] ?? tr.lastHealthStatus)}</Badge> : <Badge tone="neutral">{t("Not checked yet")}</Badge>}
                  {tr.lastCheckedAt && <span className="text-xs text-muted-foreground">{formatDateTime(tr.lastCheckedAt, lang)}</span>}
                  <span className="ms-auto flex gap-2">
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void call(`h${tr.id}`, `/api/trunks/${tr.id}/health`, { method: "POST" })}>{busy === `h${tr.id}` ? t("Checking…") : t("Check health")}</Button>
                    {canManage && <Button size="sm" variant="outline" disabled={!!busy} onClick={() => { if (confirm(t("Delete this trunk? Numbers on it go back to Twilio's own handling."))) void call(`d${tr.id}`, `/api/trunks/${tr.id}`, { method: "DELETE" }); }}>{t("Delete")}</Button>}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  <div><T>Termination domain:</T> <span className="font-mono">{tr.terminationDomain ?? "—"}</span></div>
                  <div><T>Your SIP address:</T> <span className="font-mono">{tr.originationUrls.join(", ") || "—"}</span></div>
                </div>
                {tr.lastHealthJson && <ul className="grid gap-1">{tr.lastHealthJson.checks.map((c) => <li key={c.name} className="flex gap-2 text-xs"><Badge tone={TONE[c.status] ?? "neutral"}>{c.name}</Badge><span>{c.detail}</span></li>)}</ul>}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground"><T>Numbers on this trunk:</T></span>
                  {mine.length === 0 && <span className="text-muted-foreground">—</span>}
                  {mine.map((n) => <span key={n.id} className="inline-flex items-center gap-1"><span className="font-medium">{n.e164}</span>{canManage && <button type="button" className="text-danger underline" disabled={!!busy} onClick={() => void call(`x${n.id}`, `/api/trunks/${tr.id}/numbers`, { method: "POST", body: JSON.stringify({ numberId: n.id, attach: false }) })}>{t("Remove")}</button>}</span>)}
                  {canManage && free.length > 0 && <span className="inline-flex gap-1"><Select value={pick[tr.id] ?? ""} onChange={(e) => setPick((p) => ({ ...p, [tr.id]: e.target.value }))}><option value="">{t("Add a number…")}</option>{free.map((n) => <option key={n.id} value={n.id}>{n.e164}</option>)}</Select><Button size="sm" disabled={!pick[tr.id] || !!busy} onClick={() => void call(`a${tr.id}`, `/api/trunks/${tr.id}/numbers`, { method: "POST", body: JSON.stringify({ numberId: pick[tr.id], attach: true }) }, () => setPick((p) => ({ ...p, [tr.id]: "" })))}>{t("Add")}</Button></span>}
                </div>
              </div>
            );
          })}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </CardBody>
      </Card>
      {canManage && (
        <Card>
          <CardHeader title={t("Add a SIP trunk")} description={t("Give your SIP address for inbound calls, and an IP address or a login so your PBX may send outbound calls.")} />
          <CardBody>
            <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
              <Field label={t("Name")}><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required /></Field>
              <Field label={t("Your SIP address (inbound)")} hint="sip:pbx.example.com or sips:sbc.example.com:5061"><Input value={originationUrl} onChange={(e) => setOriginationUrl(e.target.value)} maxLength={255} required /></Field>
              <Field label={t("PBX public IP address (outbound)")} hint={t("Optional if you use a login below")}><Input value={allowIp} onChange={(e) => setAllowIp(e.target.value)} maxLength={15} /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("SIP username")}><Input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={32} autoComplete="off" /></Field>
                <Field label={t("SIP password")} hint={t("12+ characters, upper, lower, digit")}><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={64} autoComplete="new-password" required={!!username} /></Field>
              </div>
              <div><Button type="submit" disabled={!!busy || !name.trim() || !originationUrl.trim()}>{busy === "create" ? t("Creating…") : t("Create trunk")}</Button></div>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
