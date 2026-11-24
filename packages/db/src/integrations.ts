import { randomBytes } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { assertAuthorized, type AuthUser } from "@voiceai/auth";
import { writeAudit } from "./audit";
import { withOrg, type Db } from "./client";
import { CRM_EVENTS, crmDeliveries, crmEndpoints } from "./schema";

export class IntegrationError extends Error {}

export async function listIntegrations(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "org_settings.read");
  return withOrg(db, actor.orgId, async (tx) => {
    const endpoints = await tx.select({ id: crmEndpoints.id, name: crmEndpoints.name, url: crmEndpoints.url, events: crmEndpoints.events, active: crmEndpoints.active, createdAt: crmEndpoints.createdAt, lastHealthStatus: crmEndpoints.lastHealthStatus, lastHealthJson: crmEndpoints.lastHealthJson, lastCheckedAt: crmEndpoints.lastCheckedAt }).from(crmEndpoints).orderBy(crmEndpoints.createdAt);
    const counts = await tx.select({ endpointId: crmDeliveries.endpointId, status: crmDeliveries.status, n: sql<number>`count(*)::int` }).from(crmDeliveries).where(sql`${crmDeliveries.createdAt} > now() - interval '7 days'`).groupBy(crmDeliveries.endpointId, crmDeliveries.status);
    const last = await tx.select({ endpointId: crmDeliveries.endpointId, at: sql<Date>`max(${crmDeliveries.deliveredAt})`, ok: sql<boolean>`bool_or(${crmDeliveries.status} = 'delivered')` }).from(crmDeliveries).groupBy(crmDeliveries.endpointId);
    const testRows = await tx.execute<{ endpoint_id: string; status: string; last_status: number | null; last_error: string | null; created_at: Date }>(sql`
      select distinct on (endpoint_id) endpoint_id, status, last_status, last_error, created_at
        from crm_deliveries where event = 'ping' order by endpoint_id, created_at desc
    `);
    const tests = new Map(testRows.rows.map((r) => [r.endpoint_id, { status: r.status, lastStatus: r.last_status, lastError: r.last_error, createdAt: r.created_at }]));
    const deliveries = await tx.select({ id: crmDeliveries.id, endpointId: crmDeliveries.endpointId, event: crmDeliveries.event, status: crmDeliveries.status, attempts: crmDeliveries.attempts, lastStatus: crmDeliveries.lastStatus, lastError: crmDeliveries.lastError, nextAttemptAt: crmDeliveries.nextAttemptAt, createdAt: crmDeliveries.createdAt }).from(crmDeliveries).orderBy(desc(crmDeliveries.createdAt)).limit(40);
    return {
      events: [...CRM_EVENTS],
      endpoints: endpoints.map((e) => ({ ...e, counts: Object.fromEntries(counts.filter((c) => c.endpointId === e.id).map((c) => [c.status, c.n])) as Record<string, number>, lastDeliveredAt: last.find((l) => l.endpointId === e.id)?.at ?? null, test: tests.get(e.id) ?? null })),
      deliveries,
    };
  });
}

/** Adds an address. The secret is returned ONCE, here; it is never shown again (the receiver uses it to check the signature). */
export async function createIntegration(db: Db, actor: AuthUser, input: { name: string; url: string; events?: string[] }) {
  assertAuthorized(actor, "org_settings.write");
  const name = input.name.normalize("NFC").replace(/\s+/g, " ").trim();
  if (!name || name.length > 80) throw new IntegrationError("enter a name of up to 80 characters");
  const events = [...new Set((input.events?.length ? input.events : [...CRM_EVENTS]))];
  if (events.some((e) => !(CRM_EVENTS as readonly string[]).includes(e))) throw new IntegrationError("unknown event");
  const secret = `whsec_${randomBytes(24).toString("hex")}`;
  return withOrg(db, actor.orgId, async (tx) => {
    const n = await tx.select({ id: crmEndpoints.id }).from(crmEndpoints);
    if (n.length >= 10) throw new IntegrationError("at most 10 addresses; remove one first");
    const [row] = await tx.insert(crmEndpoints).values({ orgId: actor.orgId, name, url: input.url, secret, events, createdBy: actor.id }).returning({ id: crmEndpoints.id });
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "integration.create", entity: "crm_endpoints", entityId: row!.id, after: { name, url: input.url, events } });
    return { id: row!.id, secret };
  });
}

export async function updateIntegration(db: Db, actor: AuthUser, id: string, action: "enable" | "disable" | "delete" | "test") {
  assertAuthorized(actor, "org_settings.write");
  return withOrg(db, actor.orgId, async (tx) => {
    const [e] = await tx.select().from(crmEndpoints).where(eq(crmEndpoints.id, id));
    if (!e) throw new IntegrationError("address not found");
    if (action === "delete") await tx.delete(crmEndpoints).where(eq(crmEndpoints.id, id));
    else if (action === "test") {
      if (!e.active) throw new IntegrationError("turn this address on before sending a test");
      await tx.insert(crmDeliveries).values({ orgId: actor.orgId, endpointId: id, event: "ping", payload: { event: "ping", created_at: new Date().toISOString(), data: { message: "This is a test from Bizfy Voice AI." } } });
    }
    else await tx.update(crmEndpoints).set({ active: action === "enable" }).where(eq(crmEndpoints.id, id));
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: `integration.${action}`, entity: "crm_endpoints", entityId: id });
    return { id, action };
  });
}

/** Sends a failed delivery again from the start. */
export async function retryDelivery(db: Db, actor: AuthUser, deliveryId: string) {
  assertAuthorized(actor, "org_settings.write");
  return withOrg(db, actor.orgId, async (tx) => {
    const done = await tx.update(crmDeliveries).set({ status: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: null }).where(and(eq(crmDeliveries.id, deliveryId), eq(crmDeliveries.status, "failed"))).returning({ id: crmDeliveries.id });
    if (!done.length) throw new IntegrationError("only a failed delivery can be retried");
    return { id: deliveryId };
  });
}

// ------------------------------------------------------------------------------------------ the sender (worker)

export type CrmJob = { id: string; event: string; payload: unknown; url: string; secret: string; attempts: number };

/** The deliveries that are due now. Run by ONE worker. */
export async function crmClaim(db: Db, limit = 20): Promise<CrmJob[]> {
  const r = await db.execute<CrmJob>(sql`select id, event, payload, url, secret, attempts from worker_crm_claim(${limit})`);
  return r.rows;
}
export async function crmDone(db: Db, id: string, ok: boolean, status: number | null, error: string | null) {
  await db.execute(sql`select worker_crm_done(${id}::uuid, ${ok}, ${status}, ${error})`);
}
