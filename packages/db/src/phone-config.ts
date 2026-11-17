import { eq } from "drizzle-orm";
import { orgSettingsSchema } from "@voiceai/shared";
import { withOrg, type Db } from "./client";
import { organizations } from "./schema";

/**
 * The phone settings of an organisation (hand-off number, touch-tone menu). For the voice service, which has already checked who is
 * asking (a signed token, or a request signed by Plivo), so no user is needed here.
 */
export async function getPhoneConfig(db: Db, orgId: string) {
  const [org] = await withOrg(db, orgId, (tx) => tx.select({ s: organizations.settingsJson }).from(organizations).where(eq(organizations.id, orgId)));
  return orgSettingsSchema.parse(org?.s ?? {}).phone;
}

/** How long a caller should hear ringback while the requested colleague is being dialled. */
export async function getHandoffTimeoutSeconds(db: Db, orgId: string) {
  const [org] = await withOrg(db, orgId, (tx) => tx.select({ s: organizations.settingsJson }).from(organizations).where(eq(organizations.id, orgId)));
  return orgSettingsSchema.parse(org?.s ?? {}).ai.handoffTimeoutSeconds;
}

/** The text settings of an organisation (automatic replies), for the voice service. */
export async function getSmsSettings(db: Db, orgId: string) {
  const [org] = await withOrg(db, orgId, (tx) => tx.select({ s: organizations.settingsJson }).from(organizations).where(eq(organizations.id, orgId)));
  return orgSettingsSchema.parse(org?.s ?? {}).sms;
}
