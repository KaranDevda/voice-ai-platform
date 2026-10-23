import "server-only";
import type { AuthUser } from "@voiceai/auth";
import { listSelectableVoices } from "@voiceai/db";
import { getDb } from "./server";
import { stockVoiceOptions, type VoiceOption } from "./providers";

/** Cloned (consented, active) voices first, then the stock catalogue. Provider voice ids are never included. */
export async function voiceOptionsFor(user: AuthUser): Promise<VoiceOption[]> {
  const cloned = (await listSelectableVoices(getDb(), user.orgId)).map<VoiceOption>((v) => ({
    ref: `profile:${v.id}`, name: v.label, gender: v.gender, group: "cloned", provider: v.provider, detail: "Cloned staff voice",
  }));
  return [...cloned, ...stockVoiceOptions()];
}
