import { eq, sql } from "drizzle-orm";
import { assertAuthorized, decryptSecret, encryptSecret, parseKey, type AuthUser } from "@voiceai/auth";
import { writeAudit } from "./audit";
import type { Db, DbTx } from "./client";
import { platformSecrets } from "./schema";

/**
 * Provider keys that platform staff can set from the website (Platform > Provider keys) instead of the server's env file:
 * the phone carrier, the six payment gateways, the AI and speech services, the KYC verification service and e-mail.
 * Values are encrypted at rest (AES-256-GCM, SECRETS_ENCRYPTION_KEY or MFA_ENCRYPTION_KEY) and never sent back to a browser:
 * only the last four characters are shown. A key set here takes precedence over the env file; removing it brings the env value back.
 */
export const MANAGED_SECRETS = [
  { name: "TWILIO_ACCOUNT_SID", group: "Telephony", label: "Twilio account SID", secret: false },
  { name: "TWILIO_AUTH_TOKEN", group: "Telephony", label: "Twilio auth token", secret: true },
  { name: "PLIVO_AUTH_ID", group: "Telephony", label: "Plivo auth ID", secret: false },
  { name: "PLIVO_AUTH_TOKEN", group: "Telephony", label: "Plivo auth token", secret: true },
  { name: "PLIVO_NUMBER", group: "Telephony", label: "Plivo calling number (+91...)", secret: false },
  { name: "STRIPE_SECRET_KEY", group: "Payments", label: "Stripe secret key", secret: true },
  { name: "STRIPE_WEBHOOK_SECRET", group: "Payments", label: "Stripe webhook secret", secret: true },
  { name: "PAYPAL_CLIENT_ID", group: "Payments", label: "PayPal client ID", secret: false },
  { name: "PAYPAL_CLIENT_SECRET", group: "Payments", label: "PayPal client secret", secret: true },
  { name: "PAYPAL_WEBHOOK_ID", group: "Payments", label: "PayPal webhook ID", secret: false },
  { name: "RAZORPAY_KEY_ID", group: "Payments", label: "Razorpay key ID", secret: false },
  { name: "RAZORPAY_KEY_SECRET", group: "Payments", label: "Razorpay key secret", secret: true },
  { name: "RAZORPAY_WEBHOOK_SECRET", group: "Payments", label: "Razorpay webhook secret", secret: true },
  { name: "PAYSTACK_SECRET_KEY", group: "Payments", label: "Paystack secret key", secret: true },
  { name: "FLUTTERWAVE_SECRET_KEY", group: "Payments", label: "Flutterwave secret key", secret: true },
  { name: "FLUTTERWAVE_SECRET_HASH", group: "Payments", label: "Flutterwave webhook hash", secret: true },
  { name: "CRYPTOMUS_MERCHANT_ID", group: "Payments", label: "Cryptomus merchant ID", secret: false },
  { name: "CRYPTOMUS_API_KEY", group: "Payments", label: "Cryptomus API key", secret: true },
  { name: "OPENROUTER_API_KEY", group: "AI and voice", label: "OpenRouter API key", secret: true },
  { name: "OPENROUTER_MODEL", group: "AI and voice", label: "OpenRouter model (e.g. openai/gpt-4o-mini)", secret: false },
  { name: "LLM_PRIMARY", group: "AI and voice", label: "Main AI model: askg1 (default), openrouter or local", secret: false },
  { name: "DEEPGRAM_API_KEY", group: "AI and voice", label: "Deepgram API key", secret: true },
  { name: "ELEVENLABS_API_KEY", group: "AI and voice", label: "ElevenLabs API key", secret: true },
  { name: "CARTESIA_API_KEY", group: "AI and voice", label: "Cartesia API key", secret: true },
  { name: "KYC_PROVIDER", group: "KYC", label: "Verification service (cashfree)", secret: false },
  { name: "CASHFREE_CLIENT_ID", group: "KYC", label: "Cashfree Verification client ID", secret: false },
  { name: "CASHFREE_CLIENT_SECRET", group: "KYC", label: "Cashfree Verification client secret", secret: true },
  { name: "CASHFREE_ENV", group: "KYC", label: "Cashfree environment: sandbox or production", secret: false },
  { name: "SMTP_HOST", group: "E-mail", label: "SMTP host", secret: false },
  { name: "SMTP_PORT", group: "E-mail", label: "SMTP port", secret: false },
  { name: "SMTP_USER", group: "E-mail", label: "SMTP user", secret: false },
  { name: "SMTP_PASS", group: "E-mail", label: "SMTP password", secret: true },
  { name: "SMTP_FROM", group: "E-mail", label: "From address", secret: false },
] as const;
export type ManagedSecretName = (typeof MANAGED_SECRETS)[number]["name"];
const NAMES = new Set<string>(MANAGED_SECRETS.map((s) => s.name));

export class SecretsError extends Error {}

/** The key that encrypts provider keys: SECRETS_ENCRYPTION_KEY, or the MFA key the app already has (32 bytes, base64). */
export function secretsKeyFromEnv(env: Record<string, string | undefined> = process.env): Buffer | null {
  const raw = env.SECRETS_ENCRYPTION_KEY?.trim() || env.MFA_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  try { return parseKey(raw); } catch { return null; }
}

const hintOf = (value: string, secret: boolean) => (secret ? (value.length > 8 ? `…${value.slice(-4)}` : "…set") : value.length > 40 ? `${value.slice(0, 37)}…` : value);

async function asPlatform<T>(db: Db, fn: (tx: DbTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => { await tx.execute(sql`select set_config('app.platform', 'on', true)`); return fn(tx); });
}

/** The values the env file had before any website value replaced them, so removing a website value brings them back. */
const envBefore = new Map<string, string | undefined>();

/** Where each managed key currently comes from: set in the website, from the server's env file, or missing. */
export async function listPlatformSecrets(db: Db, actor: AuthUser) {
  assertAuthorized(actor, "platform.admin");
  const rows = await asPlatform(db, (tx) => tx.select({ name: platformSecrets.name, hint: platformSecrets.hint, updatedAt: platformSecrets.updatedAt }).from(platformSecrets));
  const byName = new Map(rows.map((r) => [r.name, r]));
  return MANAGED_SECRETS.map((s) => {
    const r = byName.get(s.name);
    const fromEnv = envBefore.has(s.name) ? envBefore.get(s.name) : process.env[s.name];
    return { ...s, source: r ? "website" as const : fromEnv?.trim() ? "server" as const : "missing" as const, hint: r?.hint ?? (fromEnv?.trim() ? hintOf(fromEnv.trim(), s.secret) : null), updatedAt: r?.updatedAt ?? null };
  });
}

/** Sets (or replaces) one key. Audited without the value. Takes effect in this process at once and in the others within a minute. */
export async function setPlatformSecret(db: Db, actor: AuthUser, name: string, value: string, key: Buffer | null = secretsKeyFromEnv()) {
  assertAuthorized(actor, "platform.admin");
  if (!NAMES.has(name)) throw new SecretsError("that key cannot be set from the website");
  const v = value.trim();
  if (!v || v.length > 4000 || /[\r\n]/.test(v)) throw new SecretsError("enter a value of 1 to 4000 characters on one line");
  if (!key) throw new SecretsError("the server has no encryption key (SECRETS_ENCRYPTION_KEY or MFA_ENCRYPTION_KEY), so keys cannot be stored safely");
  const def = MANAGED_SECRETS.find((s) => s.name === name)!;
  const hint = hintOf(v, def.secret);
  await asPlatform(db, async (tx) => {
    await tx.insert(platformSecrets).values({ name, valueEnc: encryptSecret(v, key), hint, updatedBy: actor.id, updatedAt: new Date() })
      .onConflictDoUpdate({ target: platformSecrets.name, set: { valueEnc: encryptSecret(v, key), hint, updatedBy: actor.id, updatedAt: new Date() } });
    await tx.execute(sql`select set_config('app.org_id', ${actor.orgId}, true)`);
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "platform_secret.set", entity: "platform_secrets", after: { name, hint } });
  });
  overlay(name, v);
  return { name, hint };
}

/** Removes a website value: the server's env file value (if any) applies again. */
export async function deletePlatformSecret(db: Db, actor: AuthUser, name: string) {
  assertAuthorized(actor, "platform.admin");
  if (!NAMES.has(name)) throw new SecretsError("that key cannot be set from the website");
  await asPlatform(db, async (tx) => {
    await tx.delete(platformSecrets).where(eq(platformSecrets.name, name));
    await tx.execute(sql`select set_config('app.org_id', ${actor.orgId}, true)`);
    await writeAudit(tx, { orgId: actor.orgId, actorUserId: actor.id, action: "platform_secret.remove", entity: "platform_secrets", after: { name } });
  });
  restore(name);
}

function overlay(name: string, value: string) {
  if (!envBefore.has(name)) envBefore.set(name, process.env[name]);
  process.env[name] = value;
}
function restore(name: string) {
  if (!envBefore.has(name)) return;
  const before = envBefore.get(name);
  if (before === undefined) delete process.env[name]; else process.env[name] = before;
  envBefore.delete(name);
}

/**
 * Loads the website-set keys into this process's environment (the code reads process.env when it needs a key). Values removed
 * in the website are put back to the env file's. Returns the names applied. Never throws: a server must start without them.
 */
export async function applyPlatformSecrets(db: Db, key: Buffer | null = secretsKeyFromEnv()): Promise<string[]> {
  if (!key) return [];
  try {
    const rows = await asPlatform(db, (tx) => tx.select({ name: platformSecrets.name, valueEnc: platformSecrets.valueEnc }).from(platformSecrets));
    const seen = new Set<string>();
    for (const r of rows) {
      if (!NAMES.has(r.name)) continue;
      try { overlay(r.name, decryptSecret(r.valueEnc, key)); seen.add(r.name); } catch { /* a value encrypted with another key: leave the env value */ }
    }
    for (const name of [...envBefore.keys()]) if (!seen.has(name)) restore(name);
    return [...seen];
  } catch {
    return [];
  }
}

/** Applies the website-set keys now and then every `everyMs` (default one minute). */
export function startPlatformSecrets(db: Db, o: { everyMs?: number; log?: (line: string) => void } = {}): () => void {
  let last = "";
  const run = async () => {
    const names = await applyPlatformSecrets(db);
    const now = names.sort().join(",");
    if (now !== last) { last = now; if (names.length) o.log?.(`provider keys from the website: ${names.join(", ")}`); }
  };
  void run();
  const t = setInterval(() => void run(), o.everyMs ?? 60_000);
  t.unref?.();
  return () => clearInterval(t);
}
