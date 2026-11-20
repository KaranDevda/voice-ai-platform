import { and, desc, eq, sql } from "drizzle-orm";
import { assertAuthorized, type AuthUser } from "@voiceai/auth";
import { withOrg, type Db, type DbTx } from "./client";
import { writeAudit } from "./audit";
import { AdminError } from "./platform-admin";
import { phoneNumbers, sipTrunks } from "./schema";

/** Customer SIP trunks (BYOC). The provider call is made by the caller; these functions keep our record, check who may, and audit. */
export const MAX_TRUNKS_PER_ORG = 5;
const SIP_URL = /^sips?:(?:[A-Za-z0-9._~%!$&'()*+,;=-]+@)?(?:[A-Za-z0-9.-]+|\[[0-9a-fA-F:]+\])(?::\d{1,5})?(?:;[A-Za-z0-9=._-]+)*$/;

/** A customer-typed SIP address: sip: or sips:, a public-looking host, no spaces. Throws a readable error. */
export function checkSipUrl(v: unknown): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!SIP_URL.test(s) || s.length > 255) throw new AdminError("enter your SIP address like sip:pbx.example.com or sips:sbc.example.com:5061");
  const host = (/@/.test(s) ? s.split("@")[1]! : s.replace(/^sips?:/i, "")).replace(/[:;].*$/, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || /^(10|127|0)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new AdminError("that SIP address points inside a private network; Twilio needs to reach it over the internet");
  return s;
}
export function checkTrunkName(v: unknown): string {
  const s = typeof v === "string" ? v.normalize("NFC").replace(/\s+/g, " ").trim() : "";
  if (!s) throw new AdminError("enter a name for the trunk");
  if (s.length > 60 || !/^[\p{L}\p{N} ._-]+$/u.test(s)) throw new AdminError("the trunk name can have letters, numbers, spaces, dots, dashes and underscores (up to 60)");
  return s;
}

const cols = { id: sipTrunks.id, name: sipTrunks.name, providerTrunkSid: sipTrunks.providerTrunkSid, terminationDomain: sipTrunks.terminationDomain, originationUrls: sipTrunks.originationUrls, lastHealthStatus: sipTrunks.lastHealthStatus, lastHealthJson: sipTrunks.lastHealthJson, lastCheckedAt: sipTrunks.lastCheckedAt, createdAt: sipTrunks.createdAt };

export async function listMyTrunks(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "org_settings.read");
  return withOrg(db, actor.orgId, async (tx) => ({
    trunks: await tx.select(cols).from(sipTrunks).orderBy(desc(sipTrunks.createdAt)).limit(50),
    numbers: await tx.select({ id: phoneNumbers.id, e164: phoneNumbers.e164, trunkId: phoneNumbers.trunkId }).from(phoneNumbers).where(and(eq(phoneNumbers.status, "assigned"), eq(phoneNumbers.carrier, "twilio"))),
  }));
}

/** How many trunks the organisation has (for the limit, checked before anything is created at the carrier). */
export async function assertTrunkRoom(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "org_settings.write");
  const n = await withOrg(db, actor.orgId, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(sipTrunks));
  if ((n[0]?.n ?? 0) >= MAX_TRUNKS_PER_ORG) throw new AdminError(`you can have up to ${MAX_TRUNKS_PER_ORG} SIP trunks`);
}

export async function recordTrunk(db: Db, actor: AuthUser, input: { name: string; providerTrunkSid: string; terminationDomain: string | null; originationUrls: string[] }) {
  assertAuthorized(actor, "org_settings.write");
  return withOrg(db, actor.orgId, async (tx) => {
    const [row] = await tx.insert(sipTrunks).values({ orgId: actor.orgId, name: input.name, providerTrunkSid: input.providerTrunkSid, terminationDomain: input.terminationDomain, originationUrls: input.originationUrls, createdBy: actor.id }).returning(cols);
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "sip_trunk.create", entity: "sip_trunks", entityId: row!.id, after: { name: input.name, sid: input.providerTrunkSid, originationUrls: input.originationUrls } });
    return row!;
  });
}

/** The organisation's own trunk (row-level security hides everyone else's), or an error. */
export async function getMyTrunk(db: Db, actor: AuthUser, trunkId: string) {
  assertAuthorized(actor, "org_settings.read");
  return withOrg(db, actor.orgId, async (tx) => {
    const [t] = await tx.select(cols).from(sipTrunks).where(eq(sipTrunks.id, trunkId));
    if (!t) throw new AdminError("trunk not found");
    return t;
  });
}

export async function saveTrunkHealth(db: Db, actor: AuthUser, trunkId: string, health: { status: "ok" | "degraded" | "down"; checks: Array<{ name: string; status: string; detail: string }>; checkedAt: string }) {
  assertAuthorized(actor, "org_settings.read");
  return withOrg(db, actor.orgId, async (tx) => {
    const [row] = await tx.update(sipTrunks).set({ lastHealthStatus: health.status, lastHealthJson: { checks: health.checks }, lastCheckedAt: new Date(health.checkedAt) }).where(eq(sipTrunks.id, trunkId)).returning({ id: sipTrunks.id });
    if (!row) throw new AdminError("trunk not found");
    return row;
  });
}

export async function deleteTrunkRecord(db: Db, actor: AuthUser, trunkId: string) {
  assertAuthorized(actor, "org_settings.write");
  return withOrg(db, actor.orgId, async (tx) => {
    const [t] = await tx.select(cols).from(sipTrunks).where(eq(sipTrunks.id, trunkId));
    if (!t) throw new AdminError("trunk not found");
    await tx.delete(sipTrunks).where(eq(sipTrunks.id, trunkId));
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "sip_trunk.delete", entity: "sip_trunks", entityId: trunkId, after: { name: t.name, sid: t.providerTrunkSid } });
    return t;
  });
}

/** Points one of the organisation's own Twilio numbers at a trunk (or away from it with `trunkId: null`). Returns the number for the provider call. */
export async function setNumberTrunk(db: Db, actor: AuthUser, numberId: string, trunkId: string | null) {
  assertAuthorized(actor, "org_settings.write");
  return withOrg(db, actor.orgId, async (tx: DbTx) => {
    const [n] = await tx.select({ id: phoneNumbers.id, e164: phoneNumbers.e164, carrier: phoneNumbers.carrier, trunkId: phoneNumbers.trunkId }).from(phoneNumbers).where(and(eq(phoneNumbers.id, numberId), eq(phoneNumbers.orgId, actor.orgId), eq(phoneNumbers.status, "assigned")));
    if (!n) throw new AdminError("that number is not assigned to your organisation");
    if (n.carrier !== "twilio") throw new AdminError("SIP trunks work with Twilio numbers only");
    let trunk: { providerTrunkSid: string } | undefined;
    if (trunkId) { [trunk] = await tx.select({ providerTrunkSid: sipTrunks.providerTrunkSid }).from(sipTrunks).where(eq(sipTrunks.id, trunkId)); if (!trunk) throw new AdminError("trunk not found"); }
    return { number: n, trunk };
  });
}
export async function commitNumberTrunk(db: Db, actor: AuthUser, numberId: string, trunkId: string | null) {
  assertAuthorized(actor, "org_settings.write");
  return withOrg(db, actor.orgId, async (tx) => {
    await tx.update(phoneNumbers).set({ trunkId }).where(and(eq(phoneNumbers.id, numberId), eq(phoneNumbers.orgId, actor.orgId)));
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: trunkId ? "sip_trunk.attach_number" : "sip_trunk.detach_number", entity: "phone_numbers", entityId: numberId, after: { trunkId } });
  });
}
