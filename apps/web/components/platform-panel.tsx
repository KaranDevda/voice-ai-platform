"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Select } from "./ui/form";
import { Table, Td, Th, Tr } from "./ui/table";
import { formatDateTime, titleCase } from "@/lib/utils";

interface Kyc { id: string; orgName: string; tier: string; legalName: string; pan: string; gstin: string | null; contactName: string; contactPhone: string; address: string; createdAt: string }
interface Num { id: string; e164: string; label: string | null; status: string; orgId: string | null; orgName: string | null }
interface Request { id: string; orgName: string; kind: string; country: string; purpose: string | null; createdAt: string }
interface Job { name: string; lastRunAt: string; lastOk: boolean; lastError: string | null; runs: number }
interface Found { userId: string; orgId: string; orgName: string; email: string; status: string }

/** Staff only: KYC and number requests, the number inventory, acting as a customer, and whether the background jobs are alive. */
export function PlatformPanel({ kyc, numbers, orgs, requests, jobs }: { kyc: Kyc[]; numbers: Num[]; orgs: { id: string; name: string }[]; requests: Request[]; jobs: Job[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [newNumber, setNewNumber] = useState("+91");
  const [label, setLabel] = useState("");
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<Found[] | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [mail, setMail] = useState<{ configured: boolean; host?: string; port?: number; from?: string } | null>(null);
  const [mailTo, setMailTo] = useState("");
  const [mailMsg, setMailMsg] = useState("");
  useEffect(() => { void fetch("/api/platform/email").then((r) => r.json()).then(setMail).catch(() => setMail(null)); }, []);
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
  const stale = (iso: string) => Date.now() - new Date(iso).getTime() > 120_000;

  return (
    <div className="grid gap-6">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      <Card>
        <CardHeader title="Background jobs" description="Each job reports every few seconds while it runs. Red means it failed or went quiet." />
        {jobs.length === 0 ? <CardBody><p className="text-sm text-muted-foreground">No job has reported yet. Start the worker.</p></CardBody> : (
          <Table><thead><tr><Th>Job</Th><Th>Last seen</Th><Th>State</Th><Th>Runs</Th><Th>Last error</Th></tr></thead>
            <tbody>{jobs.map((j) => <Tr key={j.name}><Td className="font-medium">{j.name}</Td><Td>{formatDateTime(j.lastRunAt)}</Td><Td><Badge tone={!j.lastOk || stale(j.lastRunAt) ? "danger" : "success"}>{!j.lastOk ? "Failing" : stale(j.lastRunAt) ? "Quiet" : "Running"}</Badge></Td><Td>{j.runs}</Td><Td className="text-muted-foreground">{j.lastError ?? ""}</Td></Tr>)}</tbody></Table>
        )}
      </Card>

      <Card>
        <CardHeader title="KYC waiting for review" />
        {kyc.length === 0 ? <CardBody><p className="text-sm text-muted-foreground">Nothing waiting.</p></CardBody> : (
          <CardBody className="grid gap-4">{kyc.map((k) => (
            <div key={k.id} className="grid gap-2 rounded-md border border-border p-3 text-sm">
              <div className="font-medium">{k.orgName} <Badge tone="warning">{titleCase(k.tier)}</Badge> <span className="font-normal text-muted-foreground">{formatDateTime(k.createdAt)}</span></div>
              <div>{k.legalName} · PAN {k.pan}{k.gstin ? ` · GSTIN ${k.gstin}` : ""}</div>
              <div className="text-muted-foreground">{k.contactName} · {k.contactPhone} · {k.address}</div>
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
        {requests.length === 0 ? <CardBody><p className="text-sm text-muted-foreground">Nothing waiting.</p></CardBody> : (
          <CardBody className="grid gap-4">{requests.map((r) => (
            <div key={r.id} className="grid gap-2 rounded-md border border-border p-3 text-sm">
              <div className="font-medium">{r.orgName} <span className="font-normal text-muted-foreground">wants a {r.kind === "tollfree" ? "toll-free" : "local"} number in {r.country} · {formatDateTime(r.createdAt)}</span></div>
              {r.purpose && <div className="text-muted-foreground">{r.purpose}</div>}
              <div className="flex flex-wrap items-end gap-2">
                <Select value={pick[r.id] ?? ""} onChange={(e) => setPick((p) => ({ ...p, [r.id]: e.target.value }))}><option value="">Choose an available number…</option>{available.map((n) => <option key={n.id} value={n.id}>{n.e164}{n.label ? ` (${n.label})` : ""}</option>)}</Select>
                <Button size="sm" disabled={!pick[r.id]} onClick={() => void post(`/api/platform/requests/${r.id}`, { approve: true, numberId: pick[r.id] })}>Approve with this number</Button>
                <Input className="max-w-xs" placeholder="Reason (needed to reject)" value={notes[r.id] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))} maxLength={300} />
                <Button size="sm" variant="outline" onClick={() => void post(`/api/platform/requests/${r.id}`, { approve: false, note: notes[r.id] })}>Reject</Button>
              </div>
            </div>
          ))}</CardBody>
        )}
      </Card>

      <Card>
        <CardHeader title="Number inventory" description="Numbers the platform owns. Add the ones you bought from Plivo, then give them to organisations." />
        <CardBody className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Number" hint="Like +919876543210"><Input value={newNumber} onChange={(e) => setNewNumber(e.target.value)} maxLength={20} /></Field>
            <Field label="Label"><Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} /></Field>
            <div className="flex items-end"><Button onClick={() => void post("/api/platform/numbers", { action: "add", e164: newNumber, label: label || undefined }, () => { setNewNumber("+91"); setLabel(""); router.refresh(); })}>Add</Button></div>
          </div>
          {numbers.length > 0 && (
            <Table><thead><tr><Th>Number</Th><Th>Label</Th><Th>Status</Th><Th>Organisation</Th><Th> </Th></tr></thead>
              <tbody>{numbers.map((n) => (
                <Tr key={n.id}>
                  <Td className="font-medium">{n.e164}</Td><Td>{n.label ?? ""}</Td><Td><Badge tone={n.status === "assigned" ? "success" : "neutral"}>{titleCase(n.status)}</Badge></Td><Td>{n.orgName ?? ""}</Td>
                  <Td className="text-right whitespace-nowrap">
                    {n.status === "assigned" ? <Button size="sm" variant="outline" onClick={() => { if (confirm(`Take ${n.e164} back from ${n.orgName}?`)) void post("/api/platform/numbers", { action: "release", numberId: n.id }); }}>Release</Button> : (
                      <span className="inline-flex gap-2"><Select value={pick[n.id] ?? ""} onChange={(e) => setPick((p) => ({ ...p, [n.id]: e.target.value }))}><option value="">Give to…</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select><Button size="sm" disabled={!pick[n.id]} onClick={() => void post("/api/platform/numbers", { action: "assign", numberId: n.id, orgId: pick[n.id] })}>Assign</Button></span>
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
          <p className="text-sm">{mail === null ? "Checking…" : mail.configured ? <>Connected to <b>{mail.host}:{mail.port}</b>, sending as <b>{mail.from}</b>.</> : "Not set up yet."}</p>
          {mail?.configured && <div className="flex flex-wrap items-end gap-2"><div className="min-w-64 flex-1"><Field label="Send a test message to"><Input type="email" value={mailTo} onChange={(e) => setMailTo(e.target.value)} /></Field></div><Button onClick={() => void testMail()} disabled={mailTo.length < 5}>Send test</Button></div>}
          {mailMsg && <p role="status" className="text-sm text-muted-foreground">{mailMsg}</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Act as a customer" description="Find a person by e-mail to see what they see. It is recorded in their organisation's audit log, lasts an hour, and shows a banner." />
        <CardBody className="grid gap-3">
          <div className="flex flex-wrap items-end gap-2"><div className="min-w-64 flex-1"><Field label="E-mail"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field></div><Button onClick={() => void search()} disabled={email.length < 3}>Find</Button></div>
          {found && (found.length === 0 ? <p className="text-sm text-muted-foreground">Nobody with that e-mail.</p> : (
            <ul className="grid gap-2 text-sm">{found.map((p) => <li key={p.userId} className="flex flex-wrap items-center gap-2"><span>{p.email} · {p.orgName} · {p.status}</span><Button size="sm" variant="outline" disabled={p.status !== "active"} onClick={() => void post("/api/platform/impersonate", { userId: p.userId, orgId: p.orgId }, () => { window.location.href = "/"; })}>Act as this person</Button></li>)}</ul>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
