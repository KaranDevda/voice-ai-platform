import { createHash, randomBytes } from "node:crypto";

export const RECOVERY_CODE_COUNT = 8;

/** Eight random one-time codes shown once, like "a1b2c-3d4e5". Only their hashes are stored. */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const h = randomBytes(5).toString("hex");
    return `${h.slice(0, 5)}-${h.slice(5)}`;
  });
}

/** Case, spaces and the dash are ignored when a code is typed back. */
export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.toLowerCase().replace(/[\s-]/g, "")).digest("hex");
}

export function parseRecoveryHashes(raw: string | null | undefined): string[] {
  try {
    const v = JSON.parse(raw ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch { return []; }
}
