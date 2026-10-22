import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";
import { decryptSecret, encryptSecret } from "./secret-box";
import { base32Encode, hotp, verifyTotp } from "./totp";

describe("totp", () => {
  // RFC 6238 appendix B, SHA-1, secret "12345678901234567890"; 8-digit codes truncated to our 6.
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  it("matches the RFC 6238 vectors", () => {
    expect(hotp(secret, Math.floor(59 / 30))).toBe("287082");
    expect(hotp(secret, Math.floor(1111111109 / 30))).toBe("081804");
    expect(hotp(secret, Math.floor(20000000000 / 30))).toBe("353130");
  });

  it("accepts ±1 step, rejects further drift and bad input", () => {
    const now = 1111111109 * 1000;
    expect(verifyTotp(secret, "081804", now)).not.toBeNull();
    expect(verifyTotp(secret, "081804", now + 30_000)).not.toBeNull();
    expect(verifyTotp(secret, "081804", now + 90_000)).toBeNull();
    expect(verifyTotp(secret, "abc123", now)).toBeNull();
  });

  it("rejects a replayed step", () => {
    const now = 1111111109 * 1000;
    const step = verifyTotp(secret, "081804", now)!;
    expect(verifyTotp(secret, "081804", now, step)).toBeNull();
  });
});

describe("password and secret box", () => {
  it("verifies argon2id hashes", async () => {
    const h = await hashPassword("correct horse");
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(h, "correct horse")).toBe(true);
    expect(await verifyPassword(h, "wrong")).toBe(false);
    expect(await verifyPassword("garbage", "x")).toBe(false);
  });

  it("round-trips and authenticates encrypted secrets", () => {
    const key = randomBytes(32);
    const boxed = encryptSecret("JBSWY3DPEHPK3PXP", key);
    expect(decryptSecret(boxed, key)).toBe("JBSWY3DPEHPK3PXP");
    expect(() => decryptSecret(boxed, randomBytes(32))).toThrow();
  });
});
