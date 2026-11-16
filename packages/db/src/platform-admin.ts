import { desc, eq, sql } from "drizzle-orm";
import { assertAuthorized, type AuthUser } from "@voiceai/auth";
import { orgSettingsSchema } from "@voiceai/shared";
import { writeAudit, type AuditEntry } from "./audit";
import { withOrg, type Db, type DbTx } from "./client";
import { jobHeartbeats, kycSubmissions, numberRequests, organizations, phoneNumbers } from "./schema";

export class AdminError extends Error {}

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const E164 = /^\+[1-9][0-9]{7,14}$/;
const text = (v: unknown, what: string, max: number) => { const t = typeof v === "string" ? v.normalize("NFC").replace(/\s+/g, " ").trim() : ""; if (!t) throw new AdminError(`enter ${what}`); if (t.length > max) throw new AdminError(`${what} is too long`); return t; };

/** Platform staff only: runs `fn` able to see every organisation's rows of the admin tables. Audit rows are written for the organisation they concern. */
async function asPlatform<T>(db: Db, actor: AuthUser, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  assertAuthorized(actor, "platform.admin");
  return db.transaction(async (tx) => { await tx.execute(sql`select set_config('app.platform', 'on', true)`); return fn(tx); });
}
const auditFor = async (tx: DbTx, entry: AuditEntry) => { await tx.execute(sql`select set_config('app.org_id', ${entry.orgId}, true)`); await writeAudit(tx, entry); };

// ------------------------------------------------------------------------------------------ KYC

const RANK = { unverified: 0, basic: 1, business: 2 } as const;

/** Refuses when the organisation requires KYC (Settings) and has not passed it. Call inside the same transaction as the work. */
export async function assertKyc(tx: DbTx, orgId: string) {
  const [org] = await tx.select({ s: organizations.settingsJson, tier: organizations.kycTier }).from(organizations).where(eq(organizations.id, orgId));
  if (org && orgSettingsSchema.parse(org.s).compliance.requireKyc && org.tier === "unverified") throw new AdminError("Complete KYC on the KYC page before running campaigns, texts or follow-ups.");
}

export interface KycInput { tier: "basic" | "business"; legalName: string; pan: string; gstin?: string; contactName: string; contactPhone: string; address: string }

export async function submitKyc(db: Db, actor: AuthUser, input: KycInput) {
  assertAuthorized(actor, "org_settings.write");
  if (input.tier !== "basic" && input.tier !== "business") throw new AdminError("choose basic or business");
  const legalName = text(input.legalName, "the legal name", 120), contactName = text(input.contactName, "a contact name", 80), address = text(input.address, "the address", 300);
  const pan = text(input.pan, "the PAN", 10).toUpperCase();
  if (!PAN.test(pan)) throw new AdminError("the PAN looks wrong (5 letters, 4 digits, 1 letter)");
  const gstin = input.gstin?.trim() ? input.gstin.trim().toUpperCase() : null;
  if (input.tier === "business" && !gstin) throw new AdminError("business verification needs the GSTIN");
  if (gstin && !GSTIN.test(gstin)) throw new AdminError("the GSTIN looks wrong (15 characters)");
  const contactPhone = text(input.contactPhone, "a contact phone", 20).replace(/[\s-]/g, "");
  if (!E164.test(contactPhone)) throw new AdminError("the contact phone must be like +919876543210");
  return withOrg(db, actor.orgId, async (tx) => {
    const [org] = await tx.select({ tier: organizations.kycTier }).from(organizations).where(eq(organizations.id, actor.orgId));
    if (org && RANK[org.tier] >= RANK[input.tier]) throw new AdminError(`this organisation is already verified at ${org.tier} level or higher`);
    const open = await tx.select({ id: kycSubmissions.id }).from(kycSubmissions).where(sql`${kycSubmissions.status} = 'pending'`).limit(1);
    if (open.length) throw new AdminError("a verification request is already waiting for review");
    const [row] = await tx.insert(kycSubmissions).values({ orgId: actor.orgId, tier: input.tier, legalName, pan, gstin, contactName, contactPhone, address, submittedBy: actor.id }).returning({ id: kycSubmissions.id });
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "kyc.submit", entity: "kyc_submissions", entityId: row!.id, after: { tier: input.tier } });
    return row!;
  });
}

export async function getKyc(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "org_settings.read");
  return withOrg(db, actor.orgId, async (tx) => {
    const [org] = await tx.select({ tier: organizations.kycTier }).from(organizations).where(eq(organizations.id, actor.orgId));
    const submissions = await tx.select({ id: kycSubmissions.id, tier: kycSubmissions.tier, status: kycSubmissions.status, legalName: kycSubmissions.legalName, reviewNote: kycSubmissions.reviewNote, createdAt: kycSubmissions.createdAt }).from(kycSubmissions).orderBy(desc(kycSubmissions.createdAt)).limit(5);
    return { tier: org?.tier ?? "unverified", submissions };
  });
}

export async function platformListKyc(db: Db, actor: AuthUser) {
  return asPlatform(db, actor, (tx) => tx.select({ id: kycSubmissions.id, orgName: organizations.name, tier: kycSubmissions.tier, legalName: kycSubmissions.legalName, pan: kycSubmissions.pan, gstin: kycSubmissions.gstin, contactName: kycSubmissions.contactName, contactPhone: kycSubmissions.contactPhone, address: kycSubmissions.address, createdAt: kycSubmissions.createdAt })
    .from(kycSubmissions).innerJoin(organizations, eq(organizations.id, kycSubmissions.orgId)).where(sql`${kycSubmissions.status} = 'pending'`).orderBy(kycSubmissions.createdAt).limit(100));
}

export async function reviewKyc(db: Db, actor: AuthUser, id: string, approve: boolean, note?: string) {
  return asPlatform(db, actor, async (tx) => {
    const [k] = await tx.select().from(kycSubmissions).where(eq(kycSubmissions.id, id));
    if (!k) throw new AdminError("request not found");
    if (k.status !== "pending") throw new AdminError("this request was already reviewed");
    if (!approve && !note?.trim()) throw new AdminError("write a reason when rejecting");
    await tx.update(kycSubmissions).set({ status: approve ? "approved" : "rejected", reviewNote: note?.trim().slice(0, 300) || null, reviewedBy: actor.id, reviewedAt: new Date() }).where(eq(kycSubmissions.id, id));
    if (approve) {
      const [org] = await tx.select({ tier: organizations.kycTier }).from(organizations).where(eq(organizations.id, k.orgId));
      if (!org || RANK[k.tier] > RANK[org.tier]) await tx.update(organizations).set({ kycTier: k.tier }).where(eq(organizations.id, k.orgId));
    }
    await auditFor(tx, { orgId: k.orgId, actorUserId: actor.id, action: approve ? "kyc.approve" : "kyc.reject", entity: "kyc_submissions", entityId: id, after: { tier: k.tier, note: note ?? null } });
    return { id, status: approve ? "approved" : "rejected" };
  });
}

// ------------------------------------------------------------------------------------------ phone numbers

export async function listMyNumbers(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "org_settings.read");
  return withOrg(db, actor.orgId, async (tx) => ({
    numbers: await tx.select({ id: phoneNumbers.id, e164: phoneNumbers.e164, label: phoneNumbers.label, capabilities: phoneNumbers.capabilities, assignedAt: phoneNumbers.assignedAt }).from(phoneNumbers).where(sql`${phoneNumbers.status} = 'assigned'`),
    requests: await tx.select({ id: numberRequests.id, kind: numberRequests.kind, country: numberRequests.country, purpose: numberRequests.purpose, status: numberRequests.status, reviewNote: numberRequests.reviewNote, createdAt: numberRequests.createdAt }).from(numberRequests).orderBy(desc(numberRequests.createdAt)).limit(20),
  }));
}

export async function requestNumber(db: Db, actor: AuthUser, input: { kind: "local" | "tollfree"; country?: string; purpose?: string }) {
  assertAuthorized(actor, "org_settings.write");
  if (input.kind !== "local" && input.kind !== "tollfree") throw new AdminError("choose local or toll-free");
  const country = (input.country ?? "IN").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new AdminError("the country must be a 2-letter code like IN");
  return withOrg(db, actor.orgId, async (tx) => {
    const open = await tx.select({ id: numberRequests.id }).from(numberRequests).where(sql`${numberRequests.status} = 'pending'`);
    if (open.length >= 3) throw new AdminError("you already have 3 requests waiting; wait for them to be reviewed");
    const [row] = await tx.insert(numberRequests).values({ orgId: actor.orgId, kind: input.kind, country, purpose: input.purpose?.trim().slice(0, 300) || null, requestedBy: actor.id }).returning({ id: numberRequests.id });
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "number.request", entity: "number_requests", entityId: row!.id, after: input });
    return row!;
  });
}

export async function platformNumbers(db: Db, actor: AuthUser) {
  return asPlatform(db, actor, async (tx) => ({
    numbers: await tx.select({ id: phoneNumbers.id, e164: phoneNumbers.e164, label: phoneNumbers.label, capabilities: phoneNumbers.capabilities, status: phoneNumbers.status, orgId: phoneNumbers.orgId, orgName: organizations.name }).from(phoneNumbers).leftJoin(organizations, eq(organizations.id, phoneNumbers.orgId)).orderBy(phoneNumbers.e164).limit(500),
    requests: await tx.select({ id: numberRequests.id, orgName: organizations.name, kind: numberRequests.kind, country: numberRequests.country, purpose: numberRequests.purpose, createdAt: numberRequests.createdAt }).from(numberRequests).innerJoin(organizations, eq(organizations.id, numberRequests.orgId)).where(sql`${numberRequests.status} = 'pending'`).orderBy(numberRequests.createdAt).limit(100),
    orgs: await tx.select({ id: organizations.id, name: organizations.name }).from(organizations).orderBy(organizations.name).limit(500),
  }));
}

export async function platformAddNumber(db: Db, actor: AuthUser, input: { e164: string; label?: string; capabilities?: string[]; status?: "available" | "pending" }) {
  const e164 = input.e164.replace(/[\s-]/g, "");
  if (!E164.test(e164)) throw new AdminError("the number must be like +919876543210");
  const capabilities = input.capabilities ?? ["voice", "sms"];
  if (capabilities.some((c) => c !== "voice" && c !== "sms")) throw new AdminError("number capabilities must be voice or sms");
  return asPlatform(db, actor, async (tx) => {
    const [row] = await tx.insert(phoneNumbers).values({ e164, label: input.label?.trim().slice(0, 80) || null, capabilities, status: input.status ?? "available" }).onConflictDoNothing().returning({ id: phoneNumbers.id });
    if (!row) throw new AdminError("that number is already in the list");
    return row;
  });
}

export async function platformAssignNumber(db: Db, actor: AuthUser, numberId: string, orgId: string) {
  return asPlatform(db, actor, async (tx) => {
    const [n] = await tx.select().from(phoneNumbers).where(eq(phoneNumbers.id, numberId));
    if (!n) throw new AdminError("number not found");
    if (n.status !== "available") throw new AdminError(n.status === "pending" ? "that number is still pending carrier verification" : "that number is not available; release it first");
    await tx.update(phoneNumbers).set({ orgId, status: "assigned", assignedAt: new Date() }).where(eq(phoneNumbers.id, numberId));
    await auditFor(tx, { orgId, actorUserId: actor.id, action: "number.assign", entity: "phone_numbers", entityId: numberId, after: { e164: n.e164 } });
    return { id: numberId };
  });
}

export async function platformReleaseNumber(db: Db, actor: AuthUser, numberId: string) {
  return asPlatform(db, actor, async (tx) => {
    const [n] = await tx.select().from(phoneNumbers).where(eq(phoneNumbers.id, numberId));
    if (!n) throw new AdminError("number not found");
    await tx.update(phoneNumbers).set({ orgId: null, status: "available", assignedAt: null }).where(eq(phoneNumbers.id, numberId));
    if (n.orgId) await auditFor(tx, { orgId: n.orgId, actorUserId: actor.id, action: "number.release", entity: "phone_numbers", entityId: numberId, after: { e164: n.e164 } });
    return { id: numberId };
  });
}

/** Approve a request by giving the organisation one of the available numbers, or reject it with a reason. */
export async function platformReviewRequest(db: Db, actor: AuthUser, id: string, input: { approve: boolean; numberId?: string; note?: string }) {
  return asPlatform(db, actor, async (tx) => {
    const [r] = await tx.select().from(numberRequests).where(eq(numberRequests.id, id));
    if (!r) throw new AdminError("request not found");
    if (r.status !== "pending") throw new AdminError("this request was already reviewed");
    if (input.approve) {
      if (!input.numberId) throw new AdminError("choose which number to give");
      const [n] = await tx.select().from(phoneNumbers).where(eq(phoneNumbers.id, input.numberId));
      if (!n || n.status !== "available") throw new AdminError("that number is not available");
      await tx.update(phoneNumbers).set({ orgId: r.orgId, status: "assigned", assignedAt: new Date() }).where(eq(phoneNumbers.id, n.id));
    } else if (!input.note?.trim()) throw new AdminError("write a reason when rejecting");
    await tx.update(numberRequests).set({ status: input.approve ? "approved" : "rejected", numberId: input.approve ? input.numberId : null, reviewNote: input.note?.trim().slice(0, 300) || null, reviewedBy: actor.id, reviewedAt: new Date() }).where(eq(numberRequests.id, id));
    await auditFor(tx, { orgId: r.orgId, actorUserId: actor.id, action: input.approve ? "number.request_approve" : "number.request_reject", entity: "number_requests", entityId: id, after: { numberId: input.numberId ?? null } });
    return { id, status: input.approve ? "approved" : "rejected" };
  });
}

// ------------------------------------------------------------------------------------------ people and jobs

/** Finds a person by e-mail across organisations (platform staff only), for impersonation. */
export async function platformFindUsers(db: Db, actor: AuthUser, email: string) {
  assertAuthorized(actor, "platform.admin");
  const r = await db.execute<{ user_id: string; org_id: string; org_name: string; email: string; status: string }>(sql`select * from platform_find_user(${email})`);
  return r.rows.map((x) => ({ userId: x.user_id, orgId: x.org_id, orgName: x.org_name, email: x.email, status: x.status }));
}

/** Writes an audit row about impersonation in the impersonated person's organisation. */
export async function auditImpersonation(db: Db, admin: { id: string; orgId: string }, target: { id: string; orgId: string }, action: "admin.impersonate_start" | "admin.impersonate_stop") {
  await withOrg(db, target.orgId, (tx) => writeAudit(tx, { orgId: target.orgId, actorUserId: admin.id, action, entity: "users", entityId: target.id, after: { adminOrgId: admin.orgId } }));
}

export async function listJobs(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "platform.admin");
  return db.select().from(jobHeartbeats).orderBy(jobHeartbeats.name);
}

/** A background job reports that it ran (and whether it worked). Used by the worker. */
export async function heartbeat(db: Db, name: string, ok: boolean, error?: string) {
  await db.execute(sql`select worker_heartbeat(${name}, ${ok}, ${error ?? null})`);
}
