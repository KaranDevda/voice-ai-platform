import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { assertAuthorized, type AuthUser } from "@voiceai/auth";
import {
  callBlockReason, formatPairingCode, normalizePairingCode, normalizePhone, orgSettingsSchema, PAIRING_ALPHABET, PAIRING_CODE_TTL_MS,
  type CallBlockReason, type DeviceCall, type RegisterDeviceInput, type SyncOutcome,
} from "@voiceai/shared";
import { writeAudit } from "./audit";
import { withOrg, type Db } from "./client";
import { checkOutboundCall, type OutboundCheck } from "./call-records";
import { loadAuthUser } from "./login";
import { callLogs, devicePairingCodes, devices, leads, organizations, users } from "./schema";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** A phone that is paired to a person. Calls it syncs are saved as that person's, under their normal access. */
export interface DeviceSession { deviceId: string; actor: AuthUser }

/**
 * A one-time code the signed-in person types into the phone app (10 minutes, single use). Only its hash is stored, and any
 * earlier unused code of theirs stops working, so there is never more than one open door per person.
 */
export async function createPairingCode(db: Db, actor: AuthUser, now = new Date()): Promise<{ code: string; expiresAt: Date }> {
  assertAuthorized(actor, "calls.place");
  const code = Array.from({ length: 8 }, () => PAIRING_ALPHABET[randomInt(PAIRING_ALPHABET.length)]).join("");
  const expiresAt = new Date(now.getTime() + PAIRING_CODE_TTL_MS);
  await withOrg(db, actor.orgId, async (tx) => {
    await tx.delete(devicePairingCodes).where(and(eq(devicePairingCodes.userId, actor.id), isNull(devicePairingCodes.usedAt)));
    await tx.insert(devicePairingCodes).values({ orgId: actor.orgId, userId: actor.id, codeHash: sha256(code), expiresAt });
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "device.pairing_code_created", entity: "users", entityId: actor.id });
  });
  return { code: formatPairingCode(code), expiresAt };
}

/**
 * First contact from a phone: trades a pairing code for a device token. The token is returned once and only its hash is
 * kept. Pairing the same phone again (same fingerprint) replaces its token and un-revokes it, because the person proved
 * who they are with a fresh code.
 */
export async function registerDevice(db: Db, input: RegisterDeviceInput): Promise<{ deviceId: string; token: string; email: string } | null> {
  const claimed = await db.execute<{ org_id: string; user_id: string }>(sql`select * from auth_claim_pairing_code(${sha256(normalizePairingCode(input.code))})`);
  const row = claimed.rows[0];
  if (!row) return null;
  const actor = await loadAuthUser(db, row.org_id, row.user_id);
  if (!actor?.permissions.includes("calls.place")) return null;
  const token = `vd_${randomBytes(32).toString("base64url")}`;
  return withOrg(db, row.org_id, async (tx) => {
    const [owner] = await tx.select({ teamId: users.teamId, email: users.email }).from(users).where(eq(users.id, row.user_id));
    const values = {
      orgId: row.org_id, teamId: owner?.teamId ?? null, userId: row.user_id, platform: input.platform, deviceFingerprint: input.fingerprint,
      name: input.name ?? null, appVersion: input.appVersion ?? null, workSimSlot: input.workSimSlot ?? null, tokenHash: sha256(token), revokedAt: null,
    };
    const [d] = await tx
      .insert(devices)
      .values(values)
      .onConflictDoUpdate({ target: [devices.userId, devices.deviceFingerprint], set: { ...values, orgId: undefined, userId: undefined, deviceFingerprint: undefined } })
      .returning({ id: devices.id });
    await writeAudit(tx, { orgId: row.org_id, teamId: owner?.teamId, actorUserId: row.user_id, action: "device.register", entity: "devices", entityId: d!.id, after: { platform: input.platform } });
    return { deviceId: d!.id, token, email: owner?.email ?? "" };
  });
}

/** Who a phone's token belongs to, or null when the token is unknown, the phone was revoked, or the person is suspended. */
export async function authenticateDevice(db: Db, token: string): Promise<DeviceSession | null> {
  if (!/^vd_[A-Za-z0-9_-]{40,}$/.test(token)) return null;
  const found = await db.execute<{ id: string; org_id: string; user_id: string; revoked_at: string | null }>(sql`select * from auth_find_device(${sha256(token)})`);
  const row = found.rows[0];
  if (!row || row.revoked_at) return null;
  const actor = await loadAuthUser(db, row.org_id, row.user_id);
  if (!actor?.permissions.includes("calls.place")) return null;
  return { deviceId: row.id, actor };
}

/**
 * Saves calls the phone read from its work SIM. Safe to send again and again: each call carries the phone's own id, so a
 * retry after a dropped connection saves nothing twice. A number that is not yet a lead becomes one (consent unknown),
 * so the call is not lost. Every call gets an answer, so the app knows what it can forget.
 */
export async function syncDeviceCalls(db: Db, device: DeviceSession, calls: DeviceCall[], now = new Date()): Promise<SyncOutcome[]> {
  const { actor, deviceId } = device;
  return withOrg(db, actor.orgId, async (tx) => {
    const [owner] = await tx.select({ teamId: users.teamId }).from(users).where(eq(users.id, actor.id));
    const out: SyncOutcome[] = [];
    for (const c of calls) {
      const phone = normalizePhone(c.number);
      if (!phone) { out.push({ localId: c.localId, result: "rejected", reason: "invalid_number" }); continue; }
      const startedAt = new Date(c.startedAt);
      if (startedAt.getTime() > now.getTime() + 5 * 60_000) { out.push({ localId: c.localId, result: "rejected", reason: "from_the_future" }); continue; }
      await tx.insert(leads).values({ orgId: actor.orgId, teamId: owner?.teamId ?? null, ownerUserId: actor.id, phoneE164: phone, source: "mobile_sim" })
        .onConflictDoNothing({ target: [leads.orgId, leads.phoneE164] });
      const [lead] = await tx.select({ id: leads.id }).from(leads).where(and(eq(leads.orgId, actor.orgId), eq(leads.phoneE164, phone)));
      const [row] = await tx
        .insert(callLogs)
        .values({
          orgId: actor.orgId, teamId: owner?.teamId ?? null, leadId: lead?.id ?? null, agentUserId: actor.id, direction: c.direction, source: "mobile_sim",
          status: c.status, startedAt, durationS: c.durationS, deviceId, idempotencyKey: `${deviceId}:${c.localId}`,
        })
        .onConflictDoNothing({ target: callLogs.idempotencyKey })
        .returning({ id: callLogs.id });
      out.push({ localId: c.localId, result: row ? "saved" : "duplicate" });
    }
    await tx.update(devices).set({ lastSyncAt: now }).where(eq(devices.id, deviceId));
    const saved = out.filter((o) => o.result === "saved").length;
    if (saved) await writeAudit(tx, { orgId: actor.orgId, teamId: owner?.teamId, actorUserId: actor.id, action: "device.sync", entity: "devices", entityId: deviceId, after: { saved, total: calls.length } });
    return out;
  });
}

/**
 * Before the person dials: the same Do Not Disturb, consent and calling-hours rules the AI follows. A number that is not a
 * lead has no DND or consent on file, so only the calling hours apply to it.
 */
export async function checkOutboundNumber(db: Db, actor: AuthUser, number: string, now = new Date()): Promise<OutboundCheck | { allowed: false; reason: "invalid_number" }> {
  assertAuthorized(actor, "calls.place");
  const phone = normalizePhone(number);
  if (!phone) return { allowed: false, reason: "invalid_number" };
  const lead = await withOrg(db, actor.orgId, async (tx) => (await tx.select({ id: leads.id }).from(leads).where(and(eq(leads.orgId, actor.orgId), eq(leads.phoneE164, phone))))[0]);
  if (lead) return checkOutboundCall(db, actor, lead.id, now);
  const [org] = await withOrg(db, actor.orgId, (tx) => tx.select({ s: organizations.settingsJson }).from(organizations).where(eq(organizations.id, actor.orgId)));
  const reason: CallBlockReason | null = callBlockReason({ dndFlag: false, consentStatus: "unknown" }, orgSettingsSchema.parse(org!.s).calling, now);
  return reason ? { allowed: false, reason } : { allowed: true };
}

/**
 * A call a person made from the web dialer, logged afterwards with how it went. It is saved even if it was outside the rules
 * (the call already happened, and hiding it would hide the problem); the rules are enforced before dialling, by
 * checkOutboundNumber, and a blocked attempt is audited there.
 */
export async function logDialerCall(
  db: Db, actor: AuthUser, input: { number: string; status: "connected" | "missed" | "rejected" | "failed"; durationS: number; startedAt: Date },
): Promise<{ id: string; leadId: string } | null> {
  assertAuthorized(actor, "calls.place");
  const phone = normalizePhone(input.number);
  if (!phone) return null;
  return withOrg(db, actor.orgId, async (tx) => {
    const [owner] = await tx.select({ teamId: users.teamId }).from(users).where(eq(users.id, actor.id));
    await tx.insert(leads).values({ orgId: actor.orgId, teamId: owner?.teamId ?? null, ownerUserId: actor.id, phoneE164: phone, source: "web_dialer" })
      .onConflictDoNothing({ target: [leads.orgId, leads.phoneE164] });
    const [lead] = await tx.select({ id: leads.id }).from(leads).where(and(eq(leads.orgId, actor.orgId), eq(leads.phoneE164, phone)));
    const [row] = await tx
      .insert(callLogs)
      .values({
        orgId: actor.orgId, teamId: owner?.teamId ?? null, leadId: lead!.id, agentUserId: actor.id, direction: "outbound", source: "web_dialer",
        status: input.status, startedAt: input.startedAt, durationS: Math.max(0, Math.round(input.durationS)),
      })
      .returning({ id: callLogs.id });
    return { id: row!.id, leadId: lead!.id };
  });
}
