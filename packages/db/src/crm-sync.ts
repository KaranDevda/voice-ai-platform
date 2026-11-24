import { and, desc, eq, gte, sql } from "drizzle-orm";
import { assertAuthorized, resolveScope, type AuthUser } from "@voiceai/auth";
import { LEAD_STATUSES, normalizePhone, type LeadStatus } from "@voiceai/shared";
import { writeAudit } from "./audit";
import { withOrg, type Db } from "./client";
import { crmDeliveries, crmEndpoints, crmInboundEvents, leadStatusHistory, leads, users } from "./schema";

export class CrmSyncError extends Error {}

/** One contact as a CRM sends it. Only the phone is required; what is sent replaces what we had (the CRM is the source of truth). */
export interface CrmContactIn {
  phone: string;
  name?: string | null;
  email?: string | null;
  /** Added to the lead's tags (never removes ours). */
  tags?: string[];
  /** One of our lead statuses: new, contacted, interested, callback_requested, not_interested, won, lost. */
  status?: string | null;
  /** The CRM's own id for this contact, kept in the lead's custom fields as crm_id. */
  externalId?: string | null;
  /** Extra columns, kept in the lead's custom fields. */
  fields?: Record<string, string | number | boolean | null>;
}

export interface CrmSyncResult { received: number; created: number; updated: number; statusChanges: number; invalid: number; problems: Array<{ index: number; phone?: string; problem: string }> }

const MAX_BATCH = 500;
const clip = (v: unknown, max: number) => (typeof v === "string" ? v.normalize("NFC").replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * The other half of the CRM integration: the CRM sends contacts in (with an API token that has leads.write) and they are created
 * or updated here, matched by phone number. Changes made this way are NOT sent back to the CRM as webhooks (no echo loop), are
 * written to the status history and audit log, and each batch is logged so the Integrations page can show what came in.
 * Updating existing leads needs leads.write for all leads; with a narrower scope only new contacts are created.
 */
export async function syncContactsFromCrm(db: Db, actor: AuthUser, input: CrmContactIn[]): Promise<CrmSyncResult> {
  assertAuthorized(actor, "leads.write");
  if (!Array.isArray(input)) throw new CrmSyncError("send a list of contacts");
  if (input.length === 0) throw new CrmSyncError("the list of contacts is empty");
  if (input.length > MAX_BATCH) throw new CrmSyncError(`send at most ${MAX_BATCH} contacts at a time`);
  const wide = resolveScope(actor, "leads.write") === "all";
  const result: CrmSyncResult = { received: input.length, created: 0, updated: 0, statusChanges: 0, invalid: 0, problems: [] };
  const problem = (index: number, phone: string | undefined, why: string) => { result.invalid++; if (result.problems.length < 50) result.problems.push({ index, ...(phone ? { phone } : {}), problem: why }); };

  return withOrg(db, actor.orgId, async (tx) => {
    // Changes that came from the CRM must not be sent back to it (crm_emit skips while this is on, for this transaction only).
    await tx.execute(sql`select set_config('app.crm_sync', 'on', true)`);
    const [owner] = await tx.select({ teamId: users.teamId }).from(users).where(eq(users.id, actor.id));
    const seen = new Set<string>();
    for (let i = 0; i < input.length; i++) {
      const c = input[i];
      if (!c || typeof c !== "object") { problem(i, undefined, "not a contact"); continue; }
      const phone = typeof c.phone === "string" ? normalizePhone(c.phone) : null;
      if (!phone) { problem(i, typeof c.phone === "string" ? c.phone.slice(0, 20) : undefined, "not a valid phone number"); continue; }
      if (seen.has(phone)) { problem(i, phone, "the same number appears twice in this batch"); continue; }
      seen.add(phone);
      const status = c.status == null || c.status === "" ? null : String(c.status);
      if (status && !(LEAD_STATUSES as readonly string[]).includes(status)) { problem(i, phone, `unknown status "${status.slice(0, 30)}"`); continue; }
      const name = clip(c.name, 120) || null;
      const email = clip(c.email, 200).toLowerCase() || null;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { problem(i, phone, "not a valid e-mail address"); continue; }
      const tags = Array.isArray(c.tags) ? [...new Set(c.tags.map((t) => clip(t, 40)).filter(Boolean))].slice(0, 20) : [];
      const fields: Record<string, string> = {};
      for (const [k, v] of Object.entries(c.fields ?? {}).slice(0, 30)) { const key = clip(k, 40); if (key && v != null) fields[key] = String(v).slice(0, 300); }
      if (c.externalId != null && String(c.externalId).trim()) fields.crm_id = String(c.externalId).trim().slice(0, 100);

      const [existing] = await tx.select({ id: leads.id, status: leads.status, ownerUserId: leads.ownerUserId }).from(leads).where(and(eq(leads.orgId, actor.orgId), eq(leads.phoneE164, phone)));
      if (!existing) {
        const [row] = await tx.insert(leads).values({
          orgId: actor.orgId, teamId: owner?.teamId ?? null, ownerUserId: actor.id, name, phoneE164: phone, email, tags, customFields: fields, source: "crm",
          ...(status ? { status: status as LeadStatus } : {}),
        }).returning({ id: leads.id });
        result.created++;
        if (status && status !== "new") await tx.insert(leadStatusHistory).values({ orgId: actor.orgId, leadId: row!.id, fromStatus: null, toStatus: status as LeadStatus, changedBy: "user", changedByUserId: actor.id, reason: "CRM sync" });
        continue;
      }
      if (!wide && existing.ownerUserId !== actor.id) { problem(i, phone, "this token may only update its own contacts"); continue; }
      await tx.update(leads).set({
        ...(name ? { name } : {}), ...(email ? { email } : {}),
        tags: sql`(select coalesce(array_agg(distinct t), '{}'::text[]) from unnest(${leads.tags} || ${tags.length ? sql`array[${sql.join(tags.map((t) => sql`${t}`), sql`, `)}]::text[]` : sql`'{}'::text[]`}) as t)`,
        customFields: sql`${leads.customFields} || ${JSON.stringify(fields)}::jsonb`,
        ...(status && status !== existing.status ? { status: status as LeadStatus } : {}),
      }).where(eq(leads.id, existing.id));
      result.updated++;
      if (status && status !== existing.status) {
        result.statusChanges++;
        await tx.insert(leadStatusHistory).values({ orgId: actor.orgId, leadId: existing.id, fromStatus: existing.status, toStatus: status as LeadStatus, changedBy: "user", changedByUserId: actor.id, reason: "CRM sync" });
      }
    }
    await tx.insert(crmInboundEvents).values({ orgId: actor.orgId, actorUserId: actor.id, received: result.received, created: result.created, updated: result.updated, statusChanges: result.statusChanges, invalid: result.invalid, problems: result.problems });
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "crm.sync_in", entity: "leads", after: { received: result.received, created: result.created, updated: result.updated, statusChanges: result.statusChanges, invalid: result.invalid } });
    return result;
  });
}

/** The latest batches a CRM sent in, for the Integrations page. */
export async function listCrmInbound(db: Db, actor: AuthUser, limit = 10) {
  assertAuthorized(actor, "org_settings.read");
  return withOrg(db, actor.orgId, (tx) => tx.select({ id: crmInboundEvents.id, received: crmInboundEvents.received, created: crmInboundEvents.created, updated: crmInboundEvents.updated, statusChanges: crmInboundEvents.statusChanges, invalid: crmInboundEvents.invalid, problems: crmInboundEvents.problems, createdAt: crmInboundEvents.createdAt })
    .from(crmInboundEvents).orderBy(desc(crmInboundEvents.createdAt)).limit(Math.min(limit, 50)));
}

export type HealthLevel = "ok" | "warn" | "fail";
export interface HealthCheck { check: string; level: HealthLevel; detail: string }
export interface EndpointHealth { status: "ok" | "degraded" | "down"; checks: HealthCheck[]; checkedAt: string }

/** The overall verdict: down when the endpoint cannot be reached or rejects us; degraded on warnings. Pure, for testing. */
export function healthVerdict(checks: HealthCheck[]): EndpointHealth["status"] {
  if (checks.some((c) => c.level === "fail")) return "down";
  if (checks.some((c) => c.level === "warn")) return "degraded";
  return "ok";
}

/** What the delivery log says about an endpoint over the last 24 hours (failure rate, last success). */
export async function endpointDeliveryStats(db: Db, actor: AuthUser, endpointId: string) {
  assertAuthorized(actor, "org_settings.read");
  return withOrg(db, actor.orgId, async (tx) => {
    const [ep] = await tx.select({ id: crmEndpoints.id, url: crmEndpoints.url, secret: crmEndpoints.secret, active: crmEndpoints.active, events: crmEndpoints.events }).from(crmEndpoints).where(eq(crmEndpoints.id, endpointId));
    if (!ep) return null;
    const since = new Date(Date.now() - 86_400_000);
    const [s] = await tx.select({
      total: sql<number>`count(*)::int`,
      failed: sql<number>`count(*) filter (where ${crmDeliveries.status} = 'failed' or (${crmDeliveries.status} = 'pending' and ${crmDeliveries.attempts} > 0))::int`,
      lastOk: sql<Date | null>`max(${crmDeliveries.deliveredAt})`,
    }).from(crmDeliveries).where(and(eq(crmDeliveries.endpointId, endpointId), gte(crmDeliveries.createdAt, since)));
    const [ever] = await tx.select({ lastOk: sql<Date | null>`max(${crmDeliveries.deliveredAt})` }).from(crmDeliveries).where(eq(crmDeliveries.endpointId, endpointId));
    return { endpoint: ep, total: s?.total ?? 0, failed: s?.failed ?? 0, lastDeliveredAt: ever?.lastOk ? new Date(ever.lastOk) : null };
  });
}

/** Saves the result of a health check on the endpoint (shown on the Integrations page). */
export async function saveEndpointHealth(db: Db, actor: AuthUser, endpointId: string, health: EndpointHealth) {
  assertAuthorized(actor, "org_settings.write");
  return withOrg(db, actor.orgId, async (tx) => {
    await tx.update(crmEndpoints).set({ lastHealthStatus: health.status, lastHealthJson: health, lastCheckedAt: new Date(health.checkedAt) }).where(eq(crmEndpoints.id, endpointId));
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "integration.health_check", entity: "crm_endpoints", entityId: endpointId, after: { status: health.status } });
  });
}
