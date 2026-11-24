"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Select } from "./ui/form";
import { Table, Td, Th, Tr } from "./ui/table";
import { formatDateTime, titleCase } from "@/lib/utils";
import { useT, useLang } from "./t";

interface Kyc { id: string; orgName: string; tier: string; legalName: string; pan: string; gstin: string | null; contactName: string; contactPhone: string; address: string; createdAt: string; docs: Array<{ id: string; kind: string; fileName: string; sizeBytes: number }>; panProblem: string | null; gstinProblem: string | null; verification?: GovCheck | null }
interface GovResult { status: "valid" | "invalid" | "error"; registeredName?: string; nameMatchScore?: number; gstStatus?: string; message?: string }
interface GovCheck { provider: string; checkedAt: string; pan?: GovResult; gstin?: GovResult }
interface Num { id: string; e164: string; label: string | null; capabilities: string[]; carrier?: string; status: string; orgId: string | null; orgName: string | null }
interface Request { id: string; orgName: string; kind: string; country: string; purpose: string | null; createdAt: string }
interface Job { name: string; lastRunAt: string; lastOk: boolean; lastError: string | null; runs: number }
interface Found { userId: string; orgId: string; orgName: string; email: string; status: string }
interface AvailableNumber { number: string; type: string; subType: string; city: string | null; region: string | null; monthlyRentalRate: string | null; setupRate: string | null; voiceEnabled: boolean; smsEnabled: boolean; restriction: string | null; restrictionText: string | null }

/** Staff only: KYC and number requests, the number inventory, acting as a customer, and whether the background jobs are alive. */
export function PlatformPanel({ kyc, numbers, orgs, requests, jobs }: { kyc: Kyc[]; numbers: Num[]; orgs: { id: string; name: string }[]; requests: Request[]; jobs: Job[] }) {
  const lang = useLang();
  const router = useRouter();
  const [error, setError] = useState("");
  const [jobRows, setJobRows] = useState(jobs);
  const [jobMonitorError, setJobMonitorError] = useState("");
  const [newNumber, setNewNumber] = useState("+91");
  const [newCarrier, setNewCarrier] = useState<"plivo" | "twilio">("plivo");
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [mail, setMail] = useState<{ configured: boolean; host?: string; port?: number; from?: string } | null>(null);
  const [mailTo, setMailTo] = useState("");
  const [mailMsg, setMailMsg] = useState("");
  const [shopCountry, setShopCountry] = useState("US");
  const [shopType, setShopType] = useState<"local" | "tollfree">("local");
  const [shopPattern, setShopPattern] = useState("");
  const [complianceId, setComplianceId] = useState("");
  const [shopCarrier, setShopCarrier] = useState<"plivo" | "twilio">("plivo");
  const [addressSid, setAddressSid] = useState("");
  const t = useT();
  const carrierName = shopCarrier === "twilio" ? "Twilio" : "Plivo";
  const [availableNumbers, setAvailableNumbers] = useState<AvailableNumber[]>([]);
  const [searchingNumbers, setSearchingNumbers] = useState(false);
  const [buyingNumber, setBuyingNumber] = useState("");
  const [shopError, setShopError] = useState("");
  const [shopNote, setShopNote] = useState("");
  useEffect(() => { void fetch("/api/platform/email").then((r) => r.json()).then(setMail).catch(() => setMail(null)); }, []);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/platform/jobs", { cache: "no-store" });
        if (!response.ok) throw new Error("Could not refresh worker health.");
        const current = await response.json() as Job[];
        if (active) { setJobRows(current); setJobMonitorError(""); }
      } catch {
        if (active) setJobMonitorError("Worker health could not be refreshed. Reload the page to check your connection and access.");
      }
    };
    const timer = setInterval(() => { void refresh(); }, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  async function testMail() {
    setMailMsg("Sending…");
    const res = await fetch("/api/platform/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: mailTo }) });
    const b = await res.json().catch(() => ({}));
    setMailMsg(res.ok ? "Sent. Check that inbox." : b.message ?? "That did not work");
  }
  const available = numbers.filter((n) => n.status === "available");

  async function post(url: string, body: unknown, then?: () => void) {
    setError("");
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) return setError(b.message ?? b.issues?.[0]?.message ?? b.error ?? "That did not work");
    if (then) then(); else router.refresh();
  }
  async function search() {
    setError(""); setFound(null);
    const res = await fetch(`/api/platform/users?email=${encodeURIComponent(email)}`);
    const b = await res.json().catch(() => []);
    if (!res.ok) return setError(b.message ?? b.error ?? "Search failed");
    setFound(b as Found[]);
  }
  async function searchNumbers() {
    setShopError(""); setShopNote(""); setAvailableNumbers([]); setSearchingNumbers(true);
    try {
      const query = new URLSearchParams({ carrier: shopCarrier, country: shopCountry.trim().toUpperCase(), type: shopType, services: "voice,sms", limit: "20", ...(shopPattern.trim() ? { pattern: shopPattern.trim() } : {}) });
      const res = await fetch(`/api/platform/numbers/search?${query}`);
      const result = await res.json().catch(() => ({}));
      if (!res.ok) { setShopError(result.message ?? result.hint ?? result.error ?? `Could not search ${carrierName} numbers`); return; }
      setAvailableNumbers(result as AvailableNumber[]);
      if (!result.length) setShopNote("No matching numbers found. Try another country or area pattern.");
    } catch { setShopError("Could not reach the server. Try again."); }
    finally { setSearchingNumbers(false); }
  }
  async function buyNumber(number: AvailableNumber) {
    const setup = number.setupRate === null ? "not listed" : `$${number.setupRate}`;
    const monthly = number.monthlyRentalRate === null ? "not listed" : `$${number.monthlyRentalRate}/month`;
    const extra = number.restrictionText ? `\n\nCarrier requirement: ${number.restrictionText}` : "";
    if (!confirm(`Rent ${number.number}? Setup: ${setup}. Monthly: ${monthly}.${extra}\n\nThis purchases the number on the ${carrierName} account and may incur recurring charges.`)) return;
    setShopError(""); setShopNote(""); setBuyingNumber(number.number);
    try {
      const res = await fetch("/api/platform/numbers/purchase", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        carrier: shopCarrier, voiceEnabled: number.voiceEnabled, smsEnabled: number.smsEnabled,
        number: number.number.startsWith("+") ? number.number : `+${number.number}`, countryIso: shopCountry.trim().toUpperCase(), type: shopType,
        setupRate: number.setupRate, monthlyRentalRate: number.monthlyRentalRate, ...(shopCarrier === "plivo" && complianceId.trim() ? { complianceApplicationId: complianceId.trim() } : {}), ...(shopCarrier === "twilio" && addressSid.trim() ? { addressSid: addressSid.trim() } : {}), confirmed: true,
      }) });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) { setShopError(result.message ?? (result.error === "number_price_changed" ? "Plivo’s price changed. Search again and confirm the new amount." : result.error === "inventory_sync_failed" ? `Plivo rented ${result.number}, but it was not added to inventory. Add it manually in the inventory below.` : result.error) ?? "Could not rent the number"); return; }
      setShopNote(result.status === "pending" ? `${result.number} rented, pending carrier verification; it cannot be assigned yet.` : `${result.number} rented and added to inventory.`);
      setAvailableNumbers((items) => items.filter((item) => item.number !== number.number));
      router.refresh();
    } catch { setShopError("Could not reach the server. Verify the Plivo dashboard before retrying a purchase."); }
    finally { setBuyingNumber(""); }
  }
  const stale = (iso: string) => Date.now() - new Date(iso).getTime() > 120_000;

  return (
    <div className="grid gap-6">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      <Card>
        <CardHeader title="Background jobs" description="Each job reports every few seconds while it runs. Red means it failed or went quiet." />
        {jobMonitorError && <CardBody><p role="status" className="text-sm text-danger">{jobMonitorError}</p></CardBody>}
        {jobRows.length === 0 ? <CardBody><p className="text-sm text-muted-foreground">{t("No job has reported yet. Start the worker.")}</p></CardBody> : (
          <Table><thead><tr><Th>Job</Th><Th>Last seen</Th><Th>State</Th><Th>Runs</Th><Th>Last error</Th></tr></thead>
            <tbody>{jobRows.map((j) => <Tr key={j.name}><Td className="font-medium">{j.name}</Td><Td>{formatDateTime(j.lastRunAt, lang)}</Td><Td><Badge tone={!j.lastOk || stale(j.lastRunAt) ? "danger" : "success"}>{!j.lastOk ? "Failing" : stale(j.lastRunAt) ? "Quiet" : "Running"}</Badge></Td><Td>{j.runs}</Td><Td className="text-muted-foreground">{j.lastError ?? ""}</Td></Tr>)}</tbody></Table>
        )}
      </Card>

      <Card>
        <CardHeader title="KYC waiting for review" />
        {kyc.length === 0 ? <CardBody><p className="text-sm text-muted-foreground">{t("Nothing waiting.")}</p></CardBody> : (
          <CardBody className="grid gap-4">{kyc.map((k) => (
            <div key={k.id} className="grid gap-2 rounded-md border border-border p-3 text-sm">
              <div className="font-medium">{k.orgName} <Badge tone="warning">{titleCase(k.tier)}</Badge> <span className="font-normal text-muted-foreground">{formatDateTime(k.createdAt, lang)}</span></div>
              <div>{k.legalName} · PAN {k.pan}{k.gstin ? ` · GSTIN ${k.gstin}` : ""}</div>
              <div className="text-muted-foreground">{k.contactName} · {k.contactPhone} · {k.address}</div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={k.panProblem ? "danger" : "success"}>{k.panProblem ? "PAN check failed" : "PAN format OK"}</Badge>
                {k.gstin && <Badge tone={k.gstinProblem ? "danger" : "success"}>{k.gstinProblem ? "GSTIN check failed" : "GSTIN checksum and PAN match OK"}</Badge>}
                {!k.verification && <span className="text-xs text-muted-foreground">{t("These checks do not prove the number is real: compare the documents with the details.")}</span>}
              </div>
              <GovernmentCheck v={k.verification ?? null} hasGstin={!!k.gstin} />
              {(k.panProblem || k.gstinProblem) && <div className="text-danger">{k.panProblem ?? k.gstinProblem}</div>}
              <div className="flex flex-wrap items-center gap-3">
                {k.docs.length === 0 ? <span className="text-muted-foreground">{t("No documents attached.")}</span> : k.docs.map((d) => <a key={d.id} className="underline" href={`/api/kyc/documents/${d.id}`}>{t(d.kind === "pan" ? "PAN card" : "GST certificate")} ({Math.max(1, Math.round(d.sizeBytes / 1024))} KB)</a>)}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1"><Input placeholder="Reason (needed to reject)" value={notes[k.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [k.id]: e.target.value }))} maxLength={300} /></div>
                <Button size="sm" onClick={() => void post(`/api/platform/kyc/${k.id}`, { approve: true, note: notes[k.id] })}>Approve</Button>
                <Button size="sm" variant="outline" onClick={() => void post(`/api/platform/kyc/${k.id}`, { approve: false, note: notes[k.id] })}>Reject</Button>
              </div>
            </div>
          ))}</CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="Number requests" />
        {requests.length === 0 ? <CardBody><p className="text-sm text-muted-foreground">{t("Nothing waiting.")}</p></CardBody> : (
          <CardBody className="grid gap-4">{requests.map((r) => (
            <div key={r.id} className="grid gap-2 rounded-md border border-border p-3 text-sm">
              <div className="font-medium">{r.orgName} <span className="font-normal text-muted-foreground">{t("wants a {kind} number in {country}", { kind: t(r.kind === "tollfree" ? "toll-free" : "local"), country: r.country })} · {formatDateTime(r.createdAt, lang)}</span></div>
              {r.purpose && <div className="text-muted-foreground">{r.purpose}</div>}
              <div className="flex flex-wrap items-end gap-2">
                <Select value={pick[r.id] ?? ""} onChange={(e) => setPick((p) => ({ ...p, [r.id]: e.target.value }))}><option value="">{t("Choose an available number…")}</option>{available.map((n) => <option key={n.id} value={n.id}>{n.e164}{n.label ? ` (${n.label})` : ""}</option>)}</Select>
                <Button size="sm" disabled={!pick[r.id]} onClick={() => void post(`/api/platform/requests/${r.id}`, { approve: true, numberId: pick[r.id] })}>Approve with this number</Button>
                <Input className="max-w-xs" placeholder="Reason (needed to reject)" value={notes[r.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} maxLength={300} />
                <Button size="sm" variant="outline" onClick={() => void post(`/api/platform/requests/${r.id}`, { approve: false, note: notes[r.id] })}>Reject</Button>
              </div>
            </div>
          ))}</CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title={t("Search and rent a number")} description={t("Search is read-only. Renting is charged by the carrier and requires a separate confirmation.")} />
        <CardBody className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-5">
            <Field label={t("Carrier")}><Select value={shopCarrier} onChange={(e) => { setShopCarrier(e.target.value as "plivo" | "twilio"); setAvailableNumbers([]); setShopError(""); setShopNote(""); }}><option value="plivo">Plivo</option><option value="twilio">Twilio</option></Select></Field>
            <Field label="Country" hint="Two-letter country code"><Input value={shopCountry} onChange={(e) => setShopCountry(e.target.value.toUpperCase().slice(0, 2))} maxLength={2} /></Field>
            <Field label="Number type"><Select value={shopType} onChange={(e) => setShopType(e.target.value as "local" | "tollfree")}><option value="local">{t("Local")}</option><option value="tollfree">{t("Toll-free")}</option></Select></Field>
            <Field label="Starts with (optional)"><Input value={shopPattern} onChange={(e) => setShopPattern(e.target.value.replace(/\D/g, "").slice(0, 20))} /></Field>
            <div className="flex items-end"><Button onClick={() => void searchNumbers()} disabled={searchingNumbers || shopCountry.length !== 2}>{searchingNumbers ? "Searching…" : "Search numbers"}</Button></div>
          </div>
          {shopCarrier === "plivo"
            ? <Field label="Plivo compliance application ID (if required)" hint="India and some other number types require an accepted Plivo compliance application before use."><Input value={complianceId} onChange={(e) => setComplianceId(e.target.value)} maxLength={60} /></Field>
            : <Field label={t("Twilio address SID (if required)")} hint={t("Countries with number regulations need a Twilio address or regulatory bundle (starts with AD). Leave empty for US and Canada numbers.")}><Input value={addressSid} onChange={(e) => setAddressSid(e.target.value)} maxLength={34} /></Field>}
          {shopError && <p role="alert" className="text-sm text-danger">{shopError}</p>}
          {shopNote && <p role="status" className="text-sm text-success">{shopNote}</p>}
          {availableNumbers.length > 0 && <Table><thead><tr><Th>Number</Th><Th>Location</Th><Th>Features</Th><Th>Setup</Th><Th>Monthly</Th><Th>Carrier requirement</Th><Th> </Th></tr></thead><tbody>{availableNumbers.map((n) => <Tr key={n.number}>
            <Td className="font-medium">{n.number}</Td><Td>{n.city ?? n.region ?? "—"}</Td><Td>{[n.voiceEnabled && t("Voice"), n.smsEnabled && t("SMS")].filter(Boolean).join(", ") || t("None")}</Td>
            <Td>{n.setupRate === null ? "—" : `$${n.setupRate}`}</Td><Td>{n.monthlyRentalRate === null ? "—" : `$${n.monthlyRentalRate}`}</Td><Td className="max-w-52 text-xs">{n.restrictionText ?? t("None listed")}</Td>
            <Td><Button size="sm" disabled={!!buyingNumber} onClick={() => void buyNumber(n)}>{buyingNumber === n.number ? "Renting…" : "Rent"}</Button></Td>
          </Tr>)}</tbody></Table>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Number inventory" description={t("Numbers rented from Plivo or Twilio, or added by staff. Assign available numbers to organisations.")} />
        <CardBody className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Number" hint="Like +919876543210"><Input value={newNumber} onChange={(e) => setNewNumber(e.target.value)} maxLength={20} /></Field>
            <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} /></Field>
            <Field label={t("Carrier")}><Select value={newCarrier} onChange={(e) => setNewCarrier(e.target.value as "plivo" | "twilio")}><option value="plivo">Plivo</option><option value="twilio">Twilio</option></Select></Field>
            <div className="flex items-end"><Button onClick={() => void post("/api/platform/numbers", { action: "add", e164: newNumber, label: label || undefined, carrier: newCarrier }, () => { setNewNumber("+91"); setLabel(""); router.refresh(); })}>Add</Button></div>
          </div>
          {numbers.length > 0 && (
            <Table><thead><tr><Th>Number</Th><Th>Label</Th><Th>{t("Carrier")}</Th><Th>Status</Th><Th>Organisation</Th><Th> </Th></tr></thead>
              <tbody>{numbers.map((n) => (
                <Tr key={n.id}>
                  <Td className="font-medium">{n.e164}</Td><Td>{n.label ?? ""}<div className="text-xs text-muted-foreground">{n.capabilities.join(", ")}</div></Td><Td><Badge tone="neutral">{n.carrier === "twilio" ? "Twilio" : "Plivo"}</Badge></Td><Td><Badge tone={n.status === "assigned" ? "success" : n.status === "pending" ? "warning" : "neutral"}>{titleCase(n.status)}</Badge></Td><Td>{n.orgName ?? (n.status === "pending" ? t("Carrier verification required") : "")}</Td>
                  <Td className="text-end whitespace-nowrap">
                    {n.status === "assigned" ? <Button size="sm" variant="outline" onClick={() => { if (confirm(`Take ${n.e164} back from ${n.orgName}?`)) void post("/api/platform/numbers", { action: "release", numberId: n.id }); }}>Release</Button> : (
                      n.status === "available" ? <span className="inline-flex gap-2"><Select value={pick[n.id] ?? ""} onChange={(e) => setPick((p) => ({ ...p, [n.id]: e.target.value }))}><option value="">{t("Give to…")}</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select><Button size="sm" disabled={!pick[n.id]} onClick={() => void post("/api/platform/numbers", { action: "assign", numberId: n.id, orgId: pick[n.id] })}>Assign</Button></span> : <span className="text-xs text-muted-foreground">{t("Awaiting carrier approval")}</span>
                    )}
                  </Td>
                </Tr>
              ))}</tbody></Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="E-mail (SMTP)" description="Set on the server: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM. The password is never shown here." />
        <CardBody className="grid gap-3">
          <p className="text-sm">{mail === null ? "Checking…" : mail.configured ? <>Connected to <b>{mail.host}:{mail.port}</b>, sending as <b>{mail.from}</b>.</> : t("Not set up yet.")}</p>
          {mail?.configured && <div className="flex flex-wrap items-end gap-2"><div className="min-w-64 flex-1"><Field label="Send a test message to"><Input type="email" value={mailTo} onChange={(e) => setMailTo(e.target.value)} /></Field></div><Button onClick={() => void testMail()} disabled={mailTo.length < 5}>Send test</Button></div>}
          {mailMsg && <p role="status" className="text-sm text-muted-foreground">{mailMsg}</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Act as a customer" description="Find a person by e-mail to see what they see. It is recorded in their organisation's audit log, lasts an hour, and shows a banner." />
        <CardBody className="grid gap-3">
          <div className="flex flex-wrap items-end gap-2"><div className="min-w-64 flex-1"><Field label="E-mail"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field></div><Button onClick={() => void search()} disabled={email.length < 3}>Find</Button></div>
          {found && (found.length === 0 ? <p className="text-sm text-muted-foreground">{t("Nobody with that e-mail.")}</p> : (
            <ul className="grid gap-2 text-sm">{found.map((p) => <li key={p.userId} className="flex flex-wrap items-center gap-2"><span>{p.email} · {p.orgName} · {p.status}</span><Button size="sm" variant="outline" disabled={p.status !== "active"} onClick={() => void post("/api/platform/impersonate", { userId: p.userId, orgId: p.orgId }, () => { window.location.href = "/"; })}>Act as this person</Button></li>)}</ul>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

/** What the government records said (through the KYC verification service), for the person reviewing the request. */
function GovernmentCheck({ v, hasGstin }: { v: GovCheck | null; hasGstin: boolean }) {
  const t = useT();
  if (!v) return <div className="text-xs text-muted-foreground">{t("Not checked with government records: no KYC verification service is set up (Platform > Provider keys > KYC).")}</div>;
  const line = (label: string, r: GovResult | undefined) => {
    if (!r) return null;
    const tone = r.status === "valid" ? "success" : r.status === "invalid" ? "danger" : "warning";
    const text = r.status === "valid" ? `${label} found in government records` : r.status === "invalid" ? `${label} NOT valid in government records` : `${label} could not be checked`;
    const lowMatch = r.nameMatchScore !== undefined && r.nameMatchScore < 70;
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{t(text)}</Badge>
        {r.registeredName && <span>{t("Name on record")}: <strong>{r.registeredName}</strong></span>}
        {r.nameMatchScore !== undefined && <Badge tone={lowMatch ? "danger" : "success"}>{t("Name match")} {Math.round(r.nameMatchScore)}%</Badge>}
        {r.gstStatus && <span className="text-muted-foreground">{t("GST status")}: {r.gstStatus}</span>}
        {r.message && r.status !== "valid" && <span className="text-xs text-muted-foreground">{r.message}</span>}
      </div>
    );
  };
  return (
    <div className="grid gap-1 rounded-md bg-muted/40 p-2">
      <div className="text-xs text-muted-foreground">{t("Government check")} ({v.provider}, {new Date(v.checkedAt).toLocaleString()})</div>
      {line("PAN", v.pan)}
      {hasGstin && line("GSTIN", v.gstin)}
    </div>
  );
}
