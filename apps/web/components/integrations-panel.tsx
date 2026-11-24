"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input } from "./ui/form";
import { Table, Td, Th, Tr } from "./ui/table";
import { formatDateTime, titleCase } from "@/lib/utils";
import { T, useLang } from "./t";

interface Endpoint { id: string; name: string; url: string; events: string[]; active: boolean; createdAt: string; counts: Record<string, number>; lastDeliveredAt: string | null; test: { status: string; lastStatus: number | null; lastError: string | null; createdAt: string } | null; lastHealthStatus?: string | null; lastCheckedAt?: string | null; lastHealthJson?: { checks: Array<{ check: string; level: string; detail: string }> } | null }
interface Delivery { id: string; endpointId: string; event: string; status: string; attempts: number; lastStatus: number | null; lastError: string | null; nextAttemptAt: string; createdAt: string }
const TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = { delivered: "success", failed: "danger", pending: "warning", sending: "warning" };
const EVENT_NOTE: Record<string, string> = { "call.completed": "a call ended", "call.analyzed": "summary, sentiment and next step are ready", "lead.created": "a new lead", "lead.status_changed": "a lead's status changed" };

/** Add addresses, choose events, send a test, see recent deliveries and retry failed ones. */
export function IntegrationsPanel({ canEdit, events, endpoints, deliveries }: { canEdit: boolean; events: string[]; endpoints: Endpoint[]; deliveries: Delivery[] }) {
  const lang = useLang();
  const router = useRouter();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("https://");
  const [chosen, setChosen] = useState<string[]>(events);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [checking, setChecking] = useState<string | null>(null);
  const nameOf = (id: string) => endpoints.find((e) => e.id === id)?.name ?? "";

  useEffect(() => {
    if (!endpoints.some((e) => e.test?.status === "pending" || e.test?.status === "sending")) return;
    const timer = setInterval(() => router.refresh(), 3_000);
    return () => clearInterval(timer);
  }, [endpoints, router]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setSecret(null);
    const res = await fetch("/api/integrations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, url, events: chosen }) });
    const b = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(b.message ?? b.issues?.[0]?.message ?? b.error ?? "Could not add it");
    setSecret({ name, value: b.secret }); setName(""); setUrl("https://");
    router.refresh();
  }
  async function act(id: string, action: string) {
    if (action === "delete" && !confirm("Remove this address? Its delivery history goes too.")) return;
    setError("");
    if (action === "test") setTesting(id);
    try {
      const res = await fetch(`/api/integrations/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
      if (!res.ok) setError(((await res.json().catch(() => ({}))) as { message?: string }).message ?? "That did not work");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      if (action === "test") setTesting(null);
    }
  }
  async function checkHealth(id: string) {
    setError(""); setChecking(id);
    try {
      const res = await fetch(`/api/integrations/${id}/health`, { method: "POST" });
      if (!res.ok) setError(((await res.json().catch(() => ({}))) as { message?: string }).message ?? "The health check could not run");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally { setChecking(null); }
  }
  async function retry(id: string) {
    setError("");
    const res = await fetch(`/api/integrations/deliveries/${id}`, { method: "POST" });
    if (!res.ok) setError(((await res.json().catch(() => ({}))) as { message?: string }).message ?? "That did not work");
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      {error && <p role="alert" className="text-sm text-danger"><T>{error}</T></p>}
      {secret && (
        <Card>
          <CardHeader title={`Signing secret for ${secret.name}`} description="Copy it now. It is shown only once." />
          <CardBody className="grid gap-2 text-sm">
            <code className="break-all rounded-md bg-muted px-3 py-2">{secret.value}</code>
            <p className="text-muted-foreground"><T>Every request carries</T> <code>X-Voiceai-Timestamp</code> <T>and</T> <code>X-Voiceai-Signature: sha256=…</code><T>, the HMAC-SHA256 (hex) of</T> <code>timestamp + &quot;.&quot; + raw body</code> <T>with this secret. Refuse requests whose signature does not match or whose timestamp is more than 5 minutes old. Answer with any 2xx to confirm.</T></p>
          </CardBody>
        </Card>
      )}

      {canEdit && (
        <Card>
          <CardHeader title="Add an address" description="Must start with https:// and be reachable on the public internet (addresses inside a private network are refused)." />
          <CardBody>
            <form onSubmit={create} className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></Field>
                <Field label="Address"><Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={500} required /></Field>
              </div>
              <fieldset className="grid gap-1 text-sm"><legend className="mb-1 font-medium"><T>Send me</T></legend>
                {events.map((ev) => <label key={ev} className="flex items-center gap-2"><input type="checkbox" checked={chosen.includes(ev)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, ev] : c.filter((x) => x !== ev)))} /> <code>{ev}</code> <span className="text-muted-foreground">{EVENT_NOTE[ev]}</span></label>)}
              </fieldset>
              <div><Button type="submit" disabled={busy || !name.trim() || chosen.length === 0}>{busy ? "Adding…" : "Add address"}</Button></div>
            </form>
          </CardBody>
        </Card>
      )}

      {endpoints.map((e) => {
        const bad = (e.counts.failed ?? 0) > 0;
        const testPending = e.test?.status === "pending" || e.test?.status === "sending";
        const status = !e.active ? "Off" : e.test?.status === "delivered" ? "Test passed" : e.test?.status === "failed" ? "Test failed" : testPending ? "Test waiting" : bad ? "Has failures" : "Not tested";
        const tone = !e.active ? "neutral" : e.test?.status === "delivered" ? "success" : e.test?.status === "failed" || bad ? "danger" : testPending ? "warning" : "neutral";
        return (
          <Card key={e.id}>
            <CardHeader title={e.name} description={e.url} action={<Badge tone={tone}>{status}</Badge>} />
            <CardBody className="grid gap-2 text-sm">
              <div className="text-muted-foreground"><T>Last 7 days:</T> {e.counts.delivered ?? 0} <T>delivered ·</T> {(e.counts.pending ?? 0) + (e.counts.sending ?? 0)} <T>waiting ·</T> {e.counts.failed ?? 0} <T>failed</T>{e.lastDeliveredAt ? ` · last delivered ${formatDateTime(e.lastDeliveredAt, lang)}` : ""}</div>
              {e.test ? <p role="status" className="text-muted-foreground"><T>Last test</T> {formatDateTime(e.test.createdAt, lang)}: {titleCase(e.test.status)}{e.test.lastStatus ? ` · HTTP ${e.test.lastStatus}` : ""}{e.test.lastError ? ` · ${e.test.lastError}` : ""}</p> : <p className="text-muted-foreground"><T>No connection test has run yet.</T></p>}
              <div><T>Events:</T> {e.events.map((ev) => <code key={ev} className="me-2">{ev}</code>)}</div>
              {e.lastHealthJson && e.lastCheckedAt && (
                <div className="grid gap-1 rounded-md bg-muted/40 p-2">
                  <div className="flex flex-wrap items-center gap-2"><T>Health check</T> <Badge tone={e.lastHealthStatus === "ok" ? "success" : e.lastHealthStatus === "down" ? "danger" : "warning"}>{titleCase(e.lastHealthStatus ?? "unknown")}</Badge><span className="text-xs text-muted-foreground">{formatDateTime(e.lastCheckedAt, lang)}</span></div>
                  {e.lastHealthJson.checks.map((c) => <div key={c.check} className="text-xs"><Badge tone={c.level === "ok" ? "success" : c.level === "fail" ? "danger" : "warning"}>{c.level === "ok" ? "OK" : c.level === "fail" ? "Fail" : "Warn"}</Badge> <strong><T>{c.check}</T></strong>: {c.detail}</div>)}
                </div>
              )}
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={!e.active || testing === e.id || testPending} onClick={() => void act(e.id, "test")}>{testing === e.id ? "Queuing…" : testPending ? "Test pending…" : "Send a test"}</Button>
                  <Button size="sm" variant="outline" disabled={checking === e.id} onClick={() => void checkHealth(e.id)}>{checking === e.id ? "Checking…" : "Check health"}</Button>
                  <Button size="sm" variant="outline" onClick={() => void act(e.id, e.active ? "disable" : "enable")}>{e.active ? "Turn off" : "Turn on"}</Button>
                  <Button size="sm" variant="outline" onClick={() => void act(e.id, "delete")}>Remove</Button>
                </div>
              )}
            </CardBody>
          </Card>
        );
      })}

      <Card>
        <CardHeader title="Recent deliveries" description="Newest first. A failed attempt is retried after 1 min, 5 min, 30 min, 2 h and 12 h; then it is marked failed." />
        {deliveries.length === 0 ? <CardBody><p className="text-sm text-muted-foreground"><T>Nothing sent yet. Use “Send a test”.</T></p></CardBody> : (
          <Table><thead><tr><Th>When</Th><Th>To</Th><Th>Event</Th><Th>Status</Th><Th>Tries</Th><Th>Detail</Th><Th> </Th></tr></thead>
            <tbody>{deliveries.map((d) => (
              <Tr key={d.id}>
                <Td className="whitespace-nowrap">{formatDateTime(d.createdAt, lang)}</Td><Td>{nameOf(d.endpointId)}</Td><Td><code>{d.event}</code></Td>
                <Td><Badge tone={TONE[d.status] ?? "neutral"}>{titleCase(d.status)}</Badge></Td><Td>{d.attempts}</Td>
                <Td className="max-w-xs text-xs text-muted-foreground">{d.lastError ?? (d.lastStatus ? `answered ${d.lastStatus}` : "")}{d.status === "pending" && d.attempts > 0 ? ` · next try ${formatDateTime(d.nextAttemptAt, lang)}` : ""}</Td>
                <Td className="text-end">{canEdit && d.status === "failed" && <Button size="sm" variant="outline" onClick={() => void retry(d.id)}>Retry</Button>}</Td>
              </Tr>
            ))}</tbody></Table>
        )}
      </Card>
    </div>
  );
}

interface InboundBatch { id: string; received: number; created: number; updated: number; statusChanges: number; invalid: number; problems: Array<{ index: number; phone?: string; problem: string }>; createdAt: string }

/** Two-way sync, the incoming half: how a CRM sends contacts in, and the latest batches it sent. */
export function InboundSync({ batches }: { batches: InboundBatch[] }) {
  const lang = useLang();
  const [origin, setOrigin] = useState("https://your-bizfy-address");
  useEffect(() => setOrigin(window.location.origin), []);
  const example = `curl -X POST ${origin}/api/integrations/inbound \\
  -H "Authorization: Bearer va_YOUR_API_TOKEN" -H "Content-Type: application/json" \\
  -d '{"contacts":[{"phone":"+919812345678","name":"Priya Shah","email":"priya@example.com","status":"interested","tags":["crm"],"externalId":"crm-42"}]}'`;
  return (
    <Card>
      <CardHeader title="Incoming sync (CRM to Bizfy)" description="Your CRM can also send contacts here: new numbers become leads, existing ones are updated (name, e-mail, status, tags). Changes that come in this way are not sent back to the CRM." />
      <CardBody className="grid gap-3 text-sm">
        <ol className="list-decimal ps-5 text-muted-foreground">
          <li><T>Create an API token with permission to edit leads (Account, API tokens).</T></li>
          <li><T>Have the CRM send up to 500 contacts per request to the address below. Only the phone is required; status must be one of new, contacted, interested, callback_requested, not_interested, won, lost.</T></li>
        </ol>
        <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{example}</pre>
        {batches.length === 0 ? <p className="text-muted-foreground"><T>Nothing received yet.</T></p> : (
          <Table>
            <thead><tr><Th>Received</Th><Th>Contacts</Th><Th>Created</Th><Th>Updated</Th><Th>Status changes</Th><Th>Refused</Th></tr></thead>
            <tbody>{batches.map((b) => (
              <Tr key={b.id}>
                <Td>{formatDateTime(b.createdAt, lang)}</Td><Td>{b.received}</Td><Td>{b.created}</Td><Td>{b.updated}</Td><Td>{b.statusChanges}</Td>
                <Td>{b.invalid ? <span title={b.problems.map((p) => `#${p.index + 1}${p.phone ? ` ${p.phone}` : ""}: ${p.problem}`).join("\n")}><Badge tone="warning">{b.invalid}</Badge></span> : 0}</Td>
              </Tr>
            ))}</tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}
