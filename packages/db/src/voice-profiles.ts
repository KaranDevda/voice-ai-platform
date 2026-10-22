import { and, eq } from "drizzle-orm";
import { assertAuthorized, type AuthUser } from "@voiceai/auth";
import { consentRecordInputSchema, voiceProfileInputSchema, type VoiceGender } from "@voiceai/shared";
import { writeAudit } from "./audit";
import { withOrg, type Db } from "./client";
import { consentRecords, voiceProfiles } from "./schema";

export class VoiceProfileError extends Error {}

/** Creates a cloned-voice profile; refuses unless a live staff consent for the donor exists. */
export async function createVoiceProfile(db: Db, actor: AuthUser, rawInput: unknown) {
  assertAuthorized(actor, "voice_profiles.manage");
  const input = voiceProfileInputSchema.parse(rawInput);

  return withOrg(db, actor.orgId, async (tx) => {
    const [consent] = await tx.select().from(consentRecords).where(eq(consentRecords.id, input.consentRecordId));
    if (!consent) throw new VoiceProfileError("consent record not found");
    if (consent.subjectType !== "staff" || consent.subjectId !== input.donorUserId) {
      throw new VoiceProfileError("consent record does not belong to the donor");
    }
    if (consent.revokedAt) throw new VoiceProfileError("consent has been withdrawn");

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
 * removed at ElevenLabs. SOP: revoked within 24 h of withdrawal or exit.
 */
export async function revokeVoiceProfile(
  db: Db,
  actor: AuthUser,
  profileId: string,
  deleteAtProvider: (providerVoiceId: string) => Promise<void>,
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
  await deleteAtProvider(profile.providerVoiceId);
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
