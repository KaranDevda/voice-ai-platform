import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** App-level AES-256-GCM for MFA secrets and provider keys (SOP: Data protection). Key = 32 bytes, base64. */
export function parseKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error("encryption key must be 32 bytes (base64)");
  return key;
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(boxed: string, key: Buffer): string {
  const [iv, tag, ct] = boxed.split(".").map((p) => Buffer.from(p, "base64"));
  if (!iv || !tag || !ct) throw new Error("malformed secret");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
