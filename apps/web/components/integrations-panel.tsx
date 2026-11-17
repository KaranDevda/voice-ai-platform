"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input } from "./ui/form";
import { Table, Td, Th, Tr } from "./ui/table";
import { formatDateTime, titleCase } from "@/lib/utils";

interface Endpoint { id: string; name: string; url: string; events: string[]; active: boolean; createdAt: string; counts: Record<string, number>; lastDeliveredAt: string | null; test: { status: string; lastStatus: number | null; lastError: string | null; createdAt: string } | null }
interface Delivery { id: string; endpointId: string; event: string; status: string; attempts: number; lastStatus: number | null; lastError: string | null; nextAttemptAt: string; createdAt: string }
const TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = { delivered: "success", failed: "danger", pending: "warning", sending: "warning" };
const EVENT_NOTE: Record<string, string> = { "call.completed": "a call ended", "call.analyzed": "summary, sentiment and next step are ready", "lead.created": "a new lead", "lead.status_changed": "a lead's status changed" };

/** Add addresses, choose events, send a test, see recent deliveries and retry failed ones. */
export function IntegrationsPanel({ canEdit, events, endpoints, deliveries }: { canEdit: boolean; events: string[]; endpoints: Endpoint[]; deliveries: Delivery[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("https://");
  const [chosen, setChosen] = useState<string[]>(events);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState<{ name: string; value: string } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
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
  async function retry(id: string) {
    setError("");
    const res = await fetch(`/api/integrations/deliveries/${id}`, { method: "POST" });
    if (!res.ok) setError(((await res.json().catch(() => ({}))) as { message?: string }).message ?? "That did not work");
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {secret && (
        <Card>
          <CardHeader title={`Signing secret for ${secret.name}`} description="Copy it now. It is shown only once." />
          <CardBody className="grid gap-2 text-sm">
            <code className="break-all rounded-md bg-muted px-3 py-2">{secret.value}</code>
            <p className="text-muted-foreground">Every request carries <code>X-Voiceai-Timestamp</code> and <code>X-Voiceai-Signature: sha256=…</code>, the HMAC-SHA256 (hex) of <code>timestamp + &quot;.&quot; + raw body</code> with this secret. Refuse requests whose signature does not match or whose timestamp is more than 5 minutes old. Answer with any 2xx to confirm.</p>
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
              <fieldset className="grid gap-1 text-sm"><legend className="mb-1 font-medium">Send me</legend>
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
              <div className="text-muted-foreground">Last 7 days: {e.counts.delivered ?? 0} delivered · {(e.counts.pending ?? 0) + (e.counts.sending ?? 0)} waiting · {e.counts.failed ?? 0} failed{e.lastDeliveredAt ? ` · last delivered ${formatDateTime(e.lastDeliveredAt)}` : ""}</div>
              {e.test ? <p role="status" className="text-muted-foreground">Last test {formatDateTime(e.test.createdAt)}: {titleCase(e.test.status)}{e.test.lastStatus ? ` · HTTP ${e.test.lastStatus}` : ""}{e.test.lastError ? ` · ${e.test.lastError}` : ""}</p> : <p className="text-muted-foreground">No connection test has run yet.</p>}
              <div>Events: {e.events.map((ev) => <code key={ev} className="mr-2">{ev}</code>)}</div>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={!e.active || testing === e.id || testPending} onClick={() => void act(e.id, "test")}>{testing === e.id ? "Queuing…" : testPending ? "Test pending…" : "Send a test"}</Button>
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
        {deliveries.length === 0 ? <CardBody><p className="text-sm text-muted-foreground">Nothing sent yet. Use “Send a test”.</p></CardBody> : (
          <Table><thead><tr><Th>When</Th><Th>To</Th><Th>Event</Th><Th>Status</Th><Th>Tries</Th><Th>Detail</Th><Th> </Th></tr></thead>
            <tbody>{deliveries.map((d) => (
              <Tr key={d.id}>
                <Td className="whitespace-nowrap">{formatDateTime(d.createdAt)}</Td><Td>{nameOf(d.endpointId)}</Td><Td><code>{d.event}</code></Td>
                <Td><Badge tone={TONE[d.status] ?? "neutral"}>{titleCase(d.status)}</Badge></Td><Td>{d.attempts}</Td>
                <Td className="max-w-xs text-xs text-muted-foreground">{d.lastError ?? (d.lastStatus ? `answered ${d.lastStatus}` : "")}{d.status === "pending" && d.attempts > 0 ? ` · next try ${formatDateTime(d.nextAttemptAt)}` : ""}</Td>
                <Td className="text-right">{canEdit && d.status === "failed" && <Button size="sm" variant="outline" onClick={() => void retry(d.id)}>Retry</Button>}</Td>
              </Tr>
            ))}</tbody></Table>
        )}
      </Card>
    </div>
  );
}
