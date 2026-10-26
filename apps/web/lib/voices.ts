import "server-only";
import type { AuthUser } from "@voiceai/auth";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { listSelectableVoices } from "@voiceai/db";
import { voiceFileStem } from "@voiceai/providers";
import { getDb } from "./server";
import { hasFingerprint, hindiConversionOn, stockVoiceOptions, voicesDir, type VoiceOption } from "./providers";

/** Cloned (consented, active) voices first, then the stock catalogue. Provider voice ids are never included. */
export async function voiceOptionsFor(user: AuthUser): Promise<VoiceOption[]> {
  const cloned = (await listSelectableVoices(getDb(), user.orgId)).map<VoiceOption>((v) => ({
    ref: `profile:${v.id}`, name: v.label, gender: v.gender, group: "cloned", provider: v.provider, hindiOwn: v.provider === "pocket_tts" && hindiConversionOn() && hasFingerprint(v.providerVoiceId), detail: v.providerVoiceId.startsWith("demo-voice-") ? "Demo voice (no real clone)" : "Cloned staff voice",
    // A self-hosted clone speaks Hindi only if it has its own Hindi voice file; ElevenLabs voices are multilingual.
    hindi: v.provider === "pocket_tts" ? !!process.env.KOKORO_URL?.trim() || existsSync(join(voicesDir(), `${voiceFileStem(v.providerVoiceId, "hi")}.safetensors`)) : v.provider === "elevenlabs",
  }));
  return [...cloned, ...stockVoiceOptions()];
}
