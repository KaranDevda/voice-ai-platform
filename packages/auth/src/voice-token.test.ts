import { describe, expect, it } from "vitest";
import { signVoiceToken, verifyVoiceToken } from "./voice-token";

const KEY = "a-long-test-key-0123456789abcdef";
const claims = { sub: "u1", org: "o1", voice: "pocket:alba" };

describe("voice stream tokens", () => {
  it("round-trips while fresh", () => {
    expect(verifyVoiceToken(signVoiceToken(claims, KEY, 60, 1_000_000), KEY, 1_030_000)).toEqual(claims);
  });
  it("expires", () => {
    expect(verifyVoiceToken(signVoiceToken(claims, KEY, 60, 1_000_000), KEY, 1_000_000 + 61_000)).toBeNull();
  });
  it("rejects a different key, a tampered body and malformed input", () => {
    const t = signVoiceToken(claims, KEY, 60, 1_000_000);
    expect(verifyVoiceToken(t, "another-key-0123456789abcdef0123", 1_010_000)).toBeNull();
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, org: "other", exp: 9_999_999_999 })).toString("base64url");
    expect(verifyVoiceToken(`${forged}.${sig}`, KEY, 1_010_000)).toBeNull();
    expect(body).toBeTruthy();
    for (const bad of ["", "x", "a.b.c", "....", `${body}.`]) expect(verifyVoiceToken(bad, KEY, 1_010_000)).toBeNull();
  });
  it("round-trips a campaign model and rejects malformed model claims", () => {
    const campaign = { sub: "u1", org: "o1", aiModel: "openrouter" as const, openrouterModel: "google/gemini-2.5-flash" };
    expect(verifyVoiceToken(signVoiceToken(campaign, KEY, 60, 1_000_000), KEY, 1_010_000)).toEqual(campaign);
    const malformed = { sub: "u1", org: "o1", aiModel: "openrouter" as const, openrouterModel: "not a model" } as unknown as typeof campaign;
    expect(verifyVoiceToken(signVoiceToken(malformed, KEY, 60, 1_000_000), KEY, 1_010_000)).toBeNull();
  });
  it("carries only a valid campaign agent profile ID", () => {
    const profile = { ...claims, agentProfileId: "123e4567-e89b-42d3-a456-426614174000" };
    expect(verifyVoiceToken(signVoiceToken(profile, KEY, 60, 1_000_000), KEY, 1_010_000)).toEqual(profile);
    const malformed = { ...claims, agentProfileId: "not-a-uuid" };
    expect(verifyVoiceToken(signVoiceToken(malformed, KEY, 60, 1_000_000), KEY, 1_010_000)).toBeNull();
  });
});
