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
});
