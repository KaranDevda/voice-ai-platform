import { and, eq, sql } from "drizzle-orm";
import { assertAuthorized, type AuthUser } from "@voiceai/auth";
import { consentRecordInputSchema, VOICE_GENDERS, voiceProfileInputSchema, type VoiceGender } from "@voiceai/shared";
import { writeAudit } from "./audit";
import { withOrg, type Db, type DbTx } from "./client";
import { consentRecords, users, voiceProfiles } from "./schema";

export class VoiceProfileError extends Error {}

async function checkConsent(tx: DbTx, donorUserId: string, consentRecordId: string) {
  const [consent] = await tx.select().from(consentRecords).where(eq(consentRecords.id, consentRecordId));
  if (!consent) throw new VoiceProfileError("consent record not found");
  if (consent.subjectType !== "staff" || consent.subjectId !== donorUserId) throw new VoiceProfileError("consent record does not belong to the donor");
  if (consent.revokedAt) throw new VoiceProfileError("consent has been withdrawn");
  const [used] = await tx.select({ id: voiceProfiles.id }).from(voiceProfiles).where(eq(voiceProfiles.consentRecordId, consentRecordId));
  if (used) throw new VoiceProfileError("consent is already linked to a voice");
}

/** Checks a consent is valid and unused BEFORE any provider call, so no clone is created without one. */
export async function assertConsentUsable(db: Db, actor: AuthUser, donorUserId: string, consentRecordId: string) {
  assertAuthorized(actor, "voice_profiles.manage");
  await withOrg(db, actor.orgId, (tx) => checkConsent(tx, donorUserId, consentRecordId));
}

/** Creates a cloned-voice profile; refuses unless a live staff consent for the donor exists. */
export async function createVoiceProfile(db: Db, actor: AuthUser, rawInput: unknown) {
  assertAuthorized(actor, "voice_profiles.manage");
  const input = voiceProfileInputSchema.parse(rawInput);

  return withOrg(db, actor.orgId, async (tx) => {
    await checkConsent(tx, input.donorUserId, input.consentRecordId);

    const [profile] = await tx.insert(voiceProfiles).values({ ...input, orgId: actor.orgId }).returning();
    await writeAudit(tx, {
      orgId: actor.orgId,
      actorUserId: actor.id,
      action: "voice_profile.create",
      entity: "voice_profiles",
      entityId: profile!.id,
      after: { label: profile!.label, gender: profile!.gender, consentRecordId: profile!.consentRecordId },
    });
    return profile!;
  });
}

/**
 * Revokes a profile and its consent in one transaction, then calls `deleteAtProvider` so the clone is
 * removed at its provider (ElevenLabs or the self-hosted voice server). SOP: revoked within 24 h of withdrawal or exit.
 */
export async function revokeVoiceProfile(
  db: Db,
  actor: AuthUser,
  profileId: string,
  deleteAtProvider: (providerVoiceId: string, provider: string) => Promise<void>,
) {
  assertAuthorized(actor, "voice_profiles.manage");

  const profile = await withOrg(db, actor.orgId, async (tx) => {
    const [p] = await tx.select().from(voiceProfiles).where(eq(voiceProfiles.id, profileId));
    if (!p) throw new VoiceProfileError("voice profile not found");
    if (p.status === "revoked") return p;

    const now = new Date();
    await tx.update(voiceProfiles).set({ status: "revoked", revokedAt: now }).where(eq(voiceProfiles.id, p.id));
    await tx.update(consentRecords).set({ revokedAt: now }).where(eq(consentRecords.id, p.consentRecordId));
    await writeAudit(tx, {
      orgId: actor.orgId,
      actorUserId: actor.id,
      action: "voice_profile.revoke",
      entity: "voice_profiles",
      entityId: p.id,
      before: { status: p.status },
      after: { status: "revoked" },
    });
    return p;
  });

  // After commit: if this throws the profile is already unusable, and a retry is safe.
  await deleteAtProvider(profile.providerVoiceId, profile.provider);
}

/**
 * Adds a language to an existing voice from a fresh recording. The consent already covers the voice for its purpose,
 * so no new consent is needed; the new recording is used once and deleted, like the first one. Audited.
 */
export async function addVoiceLanguage(
  db: Db,
  actor: AuthUser,
  profileId: string,
  language: string,
  perform: (profile: { providerVoiceId: string; provider: string }) => Promise<void>,
) {
  assertAuthorized(actor, "voice_profiles.manage");
  const profile = await withOrg(db, actor.orgId, async (tx) => {
    const [p] = await tx.select().from(voiceProfiles).where(eq(voiceProfiles.id, profileId));
    if (!p) throw new VoiceProfileError("voice profile not found");
    if (p.status !== "active") throw new VoiceProfileError("this voice has been revoked");
    const [consent] = await tx.select().from(consentRecords).where(eq(consentRecords.id, p.consentRecordId));
    if (!consent || consent.revokedAt) throw new VoiceProfileError("consent has been withdrawn");
    return p;
  });
  await perform({ providerVoiceId: profile.providerVoiceId, provider: profile.provider });
  await withOrg(db, actor.orgId, (tx) =>
    writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "voice_profile.add_language", entity: "voice_profiles", entityId: profile.id, after: { language } }),
  );
}

/** Voice switcher: active voices an agent or campaign can pick from. */
export async function listSelectableVoices(db: Db, orgId: string, gender?: VoiceGender) {
  return withOrg(db, orgId, (tx) =>
    tx
      .select()
      .from(voiceProfiles)
      .where(and(eq(voiceProfiles.status, "active"), gender ? eq(voiceProfiles.gender, gender) : undefined)),
  );
}

/**
 * Picks the voice for a call: explicit choice, else campaign default, else first active voice.
 * An explicit or campaign voice that has been revoked is an error, never a silent fallback to another person's voice.
 */
export async function resolveCallVoice(
  db: Db,
  orgId: string,
  choice: { voiceProfileId?: string; campaignDefaultId?: string },
) {
  const wanted = choice.voiceProfileId ?? choice.campaignDefaultId;
  return withOrg(db, orgId, async (tx) => {
    if (wanted) {
      const [p] = await tx.select().from(voiceProfiles).where(eq(voiceProfiles.id, wanted));
      if (!p || p.status !== "active") throw new VoiceProfileError("requested voice is not active");
      return p;
    }
    const [p] = await tx.select().from(voiceProfiles).where(eq(voiceProfiles.status, "active")).limit(1);
    if (!p) throw new VoiceProfileError("no active voice profile");
    return p;
  });
}

/** Records a staff member's signed voice-clone consent; required before a voice profile can reference it. */
export async function createConsentRecord(db: Db, actor: AuthUser, rawInput: unknown) {
  assertAuthorized(actor, "voice_profiles.manage");
  const input = consentRecordInputSchema.parse(rawInput);

  return withOrg(db, actor.orgId, async (tx) => {
    const [record] = await tx.insert(consentRecords).values({ ...input, orgId: actor.orgId }).returning();
    await writeAudit(tx, {
      orgId: actor.orgId,
      actorUserId: actor.id,
      action: "consent.create",
      entity: "consent_records",
      entityId: record!.id,
      after: { subjectType: record!.subjectType, subjectId: record!.subjectId, purpose: record!.purpose },
    });
    return record!;
  });
}

const clean = (v: string) => v.normalize("NFC").replace(/\s+/g, " ").trim();

/**
 * Finds the person by first and last name, or adds them as a voice donor. A donor is a staff record that cannot sign in
 * (status disabled, no usable password), so consents and voices still point at a real person without making up an account.
 */
export async function findOrCreateVoiceDonor(db: Db, actor: AuthUser, rawFirst: string, rawLast: string) {
  assertAuthorized(actor, "voice_profiles.manage");
  const first = clean(rawFirst), last = clean(rawLast);
  if (!first || !last) throw new VoiceProfileError("enter both a first name and a last name");
  if (first.length > 60 || last.length > 60) throw new VoiceProfileError("names must be 60 characters or fewer");
  return withOrg(db, actor.orgId, async (tx) => {
    const [found] = await tx
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(and(sql`lower(${users.firstName}) = lower(${first})`, sql`lower(${users.lastName}) = lower(${last})`));
    if (found) return { id: found.id, firstName: found.firstName ?? first, lastName: found.lastName ?? last, created: false };
    const [created] = await tx
      .insert(users)
      .values({
        orgId: actor.orgId, firstName: first, lastName: last,
        // Unique, never typed by anyone, and on an address that cannot receive mail.
        email: `donor-${crypto.randomUUID()}@voice-donor.invalid`,
        passwordHash: "!", status: "disabled",
      })
      .returning({ id: users.id });
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "voice_donor.create", entity: "users", entityId: created!.id, after: { firstName: first, lastName: last } });
    return { id: created!.id, firstName: first, lastName: last, created: true };
  });
}

/**
 * Corrects a voice's name or gender after cloning, for example when the wrong gender was left selected. Gender matters:
 * it picks the built-in Hindi voice, so a wrong one makes Hindi sound like someone else. Revoked voices cannot be edited.
 * Audited with the old and new values.
 */
export async function updateVoiceProfile(db: Db, actor: AuthUser, profileId: string, rawInput: unknown) {
  assertAuthorized(actor, "voice_profiles.manage");
  const raw = (rawInput ?? {}) as { label?: unknown; gender?: unknown };
  const label = typeof raw.label === "string" ? raw.label.normalize("NFC").replace(/\s+/g, " ").trim() : "";
  if (!label) throw new VoiceProfileError("enter a name for the voice");
  if (label.length > 80) throw new VoiceProfileError("the name must be 80 characters or fewer");
  if (!(VOICE_GENDERS as readonly unknown[]).includes(raw.gender)) throw new VoiceProfileError("choose male or female");
  const input = { label, gender: raw.gender as VoiceGender };
  return withOrg(db, actor.orgId, async (tx) => {
    const [before] = await tx.select().from(voiceProfiles).where(eq(voiceProfiles.id, profileId));
    if (!before) throw new VoiceProfileError("voice profile not found");
    if (before.status !== "active") throw new VoiceProfileError("a revoked voice cannot be edited");
    if (before.label === input.label && before.gender === input.gender) return before;
    const [after] = await tx.update(voiceProfiles).set({ label: input.label, gender: input.gender }).where(eq(voiceProfiles.id, profileId)).returning();
    await writeAudit(tx, {
      orgId: actor.orgId, actorUserId: actor.id, action: "voice_profile.update", entity: "voice_profiles", entityId: profileId,
      before: { label: before.label, gender: before.gender }, after: { label: after!.label, gender: after!.gender },
    });
    return after!;
  });
}
