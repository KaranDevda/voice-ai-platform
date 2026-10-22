import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const TOTP_STEP_S = 30;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text.replace(/=+$/, "").toUpperCase()) {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const generateTotpSecret = () => base32Encode(randomBytes(20));

/** RFC 6238 (HMAC-SHA1, 6 digits) for a given counter. */
export function hotp(secretBase32: string, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secretBase32)).update(msg).digest();
  const o = h[h.length - 1]! & 15;
  const code = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(code % 10 ** digits).padStart(digits, "0");
}

/**
 * Checks a code within ±1 step of `nowMs`. Returns the matched time step (store it and pass it as
 * `lastStep` next time so a code cannot be replayed), or null.
 */
export function verifyTotp(secret: string, code: string, nowMs = Date.now(), lastStep = -1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(nowMs / 1000 / TOTP_STEP_S);
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code)) && step > lastStep) return step;
  }
  return null;
}

export function totpUri(secret: string, accountEmail: string, issuer = "Voice AI Platform"): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=${TOTP_STEP_S}`;
}
