import { z } from "zod";
import { endpointDeliveryStats, healthVerdict, saveEndpointHealth, type EndpointHealth, type HealthCheck } from "@voiceai/db";
import { assertPublicUrl, sendCrmWebhook } from "@voiceai/providers";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/**
 * Integration health test: several checks in one go, each with a plain verdict.
 *  1. switched on;  2. the address is public HTTPS and resolves;  3. a signed request is accepted (2xx) and how fast;
 *  4. the failure rate of the last 24 hours of deliveries;  5. when it last received something.
 * The result is saved on the endpoint and shown on the Integrations page.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const stats = await endpointDeliveryStats(getDb(), user, id.data);
    if (!stats) return Response.json({ error: "not_found" }, { status: 404 });
    const { endpoint } = stats;
    const checks: HealthCheck[] = [];
    checks.push(endpoint.active ? { check: "Switched on", level: "ok", detail: "Events are being sent to this address." } : { check: "Switched on", level: "warn", detail: "This address is switched off: nothing is sent to it." });
    let addressOk = true;
    try {
      const url = await assertPublicUrl(endpoint.url);
      checks.push(url.protocol === "https:" ? { check: "Address", level: "ok", detail: `${url.host} resolves to a public address over HTTPS.` } : { check: "Address", level: "fail", detail: "The address must use https://." });
      if (url.protocol !== "https:") addressOk = false;
    } catch (e) {
      addressOk = false;
      checks.push({ check: "Address", level: "fail", detail: e instanceof Error ? e.message : "the address could not be resolved" });
    }
    if (addressOk) {
      const t0 = Date.now();
      const r = await sendCrmWebhook({ id: `health-${Date.now()}`, event: "ping", url: endpoint.url, secret: endpoint.secret, payload: { event: "ping", created_at: new Date().toISOString(), data: { message: "Health check from Bizfy Voice AI." } } });
      const ms = Date.now() - t0;
      if (!r.ok) checks.push({ check: "Accepts signed requests", level: "fail", detail: r.error ?? `answered ${r.status}` });
      else checks.push({ check: "Accepts signed requests", level: ms > 3000 ? "warn" : "ok", detail: `answered ${r.status} in ${ms} ms over a valid HTTPS certificate${ms > 3000 ? " (slow: over 3 seconds)" : ""}.` });
    }
    const rate = stats.total ? stats.failed / stats.total : 0;
    checks.push(stats.total === 0
      ? { check: "Last 24 hours", level: "ok", detail: "No events in the last 24 hours." }
      : { check: "Last 24 hours", level: stats.total >= 10 && rate >= 0.5 ? "fail" : rate >= 0.2 ? "warn" : "ok", detail: `${stats.total - stats.failed} of ${stats.total} events delivered (${Math.round(rate * 100)}% failed or retrying).` });
    checks.push(stats.lastDeliveredAt
      ? { check: "Last delivery", level: "ok", detail: `Last delivered ${stats.lastDeliveredAt.toISOString().replace("T", " ").slice(0, 16)} UTC.` }
      : { check: "Last delivery", level: stats.total ? "warn" : "ok", detail: stats.total ? "Nothing has been delivered yet." : "Nothing sent yet." });
    const health: EndpointHealth = { status: healthVerdict(checks), checks, checkedAt: new Date().toISOString() };
    await saveEndpointHealth(getDb(), user, id.data, health);
    return Response.json(health);
  } catch (err) { return toResponse(err); }
}
