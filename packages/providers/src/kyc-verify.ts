/**
 * Real PAN and GSTIN checks against the government records, through a KYC verification service. One provider for now:
 * Cashfree Secure ID (Verification API), which answers from the Income Tax Department (PAN) and the GST Network (GSTIN).
 *
 * ASSUMPTION, not yet verified against a live account: request and response shapes follow Cashfree's documented
 * POST {base}/pan {pan, name} and POST {base}/gstin {GSTIN, business_name}, authenticated with x-client-id / x-client-secret.
 * The parser accepts the documented field names and close variants; check the first live answers and adjust if needed.
 */

export interface KycCheck {
  status: "valid" | "invalid" | "error";
  registeredName?: string;
  nameMatchScore?: number;
  gstStatus?: string;
  message?: string;
}

export interface KycVerifier {
  provider: string;
  verifyPan(pan: string, name: string): Promise<KycCheck>;
  verifyGstin(gstin: string, businessName: string): Promise<KycCheck>;
}

export interface CashfreeVerifierConfig {
  clientId: string;
  clientSecret: string;
  /** "sandbox" (default) or "production". */
  environment?: "sandbox" | "production";
  /** Overrides the base URL (tests). */
  baseUrl?: string;
  /** Sent as x-api-version when set (some Cashfree accounts require it). */
  apiVersion?: string;
  fetch?: typeof fetch;
}

type Json = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => { const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : Number.NaN; return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : undefined; };
const bool = (v: unknown) => (typeof v === "boolean" ? v : typeof v === "string" ? (/^(true|valid|yes|y)$/i.test(v) ? true : /^(false|invalid|no|n)$/i.test(v) ? false : undefined) : undefined);

/** Reads a PAN answer. Exported for tests. */
export function parsePanAnswer(httpStatus: number, body: Json): KycCheck {
  const message = str(body.message) ?? str(body.error) ?? str((body as { error_description?: unknown }).error_description);
  if (httpStatus === 401 || httpStatus === 403) return { status: "error", message: `the verification service refused our keys (${httpStatus})` };
  if (httpStatus >= 500 || httpStatus === 429) return { status: "error", message: message ?? `the verification service failed (${httpStatus})` };
  const valid = bool(body.valid) ?? bool(body.pan_status) ?? (str(body.pan_status)?.toUpperCase() === "VALID" ? true : undefined);
  const registeredName = str(body.registered_name) ?? str(body.name_pan_card) ?? str(body.name);
  const nameMatchScore = num(body.name_match_score);
  if (valid === true) return { status: "valid", ...(registeredName ? { registeredName } : {}), ...(nameMatchScore !== undefined ? { nameMatchScore } : {}), ...(message ? { message } : {}) };
  if (valid === false || httpStatus === 400 || httpStatus === 404 || httpStatus === 422) return { status: "invalid", message: message ?? "PAN not found" };
  return { status: "error", message: message ?? `unexpected answer (${httpStatus})` };
}

/** Reads a GSTIN answer. A registered GSTIN that is not "Active" (cancelled, suspended) counts as invalid. Exported for tests. */
export function parseGstinAnswer(httpStatus: number, body: Json): KycCheck {
  const message = str(body.message) ?? str(body.error);
  if (httpStatus === 401 || httpStatus === 403) return { status: "error", message: `the verification service refused our keys (${httpStatus})` };
  if (httpStatus >= 500 || httpStatus === 429) return { status: "error", message: message ?? `the verification service failed (${httpStatus})` };
  const exists = bool(body.valid);
  const gstStatus = str(body.gst_in_status) ?? str(body.gstin_status) ?? str(body.status);
  const registeredName = str(body.legal_name_of_business) ?? str(body.legal_name) ?? str(body.trade_name_of_business);
  if (exists === false || httpStatus === 400 || httpStatus === 404 || httpStatus === 422) return { status: "invalid", message: message ?? "GSTIN not found", ...(gstStatus ? { gstStatus } : {}) };
  if (exists === true || gstStatus) {
    const active = !gstStatus || /^active$/i.test(gstStatus);
    return { status: active ? "valid" : "invalid", ...(gstStatus ? { gstStatus } : {}), ...(registeredName ? { registeredName } : {}), ...(message ? { message } : {}) };
  }
  return { status: "error", message: message ?? `unexpected answer (${httpStatus})` };
}

export function createCashfreeVerifier(config: CashfreeVerifierConfig): KycVerifier {
  const base = (config.baseUrl ?? (config.environment === "production" ? "https://api.cashfree.com/verification" : "https://sandbox.cashfree.com/verification")).replace(/\/$/, "");
  const doFetch = config.fetch ?? fetch;
  const call = async (path: string, body: Json): Promise<{ status: number; json: Json }> => {
    const res = await doFetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "x-client-id": config.clientId, "x-client-secret": config.clientSecret, ...(config.apiVersion ? { "x-api-version": config.apiVersion } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as Json;
    return { status: res.status, json };
  };
  return {
    provider: "cashfree",
    async verifyPan(pan, name) {
      const r = await call("/pan", { pan, name });
      return parsePanAnswer(r.status, r.json);
    },
    async verifyGstin(gstin, businessName) {
      const r = await call("/gstin", { GSTIN: gstin, business_name: businessName });
      return parseGstinAnswer(r.status, r.json);
    },
  };
}

/** The verifier configured in the environment (KYC_PROVIDER=cashfree + CASHFREE_CLIENT_ID/SECRET), or null when none is set up. */
export function kycVerifierFromEnv(env: Record<string, string | undefined> = process.env, doFetch?: typeof fetch): KycVerifier | null {
  const provider = (env.KYC_PROVIDER?.trim() || (env.CASHFREE_CLIENT_ID ? "cashfree" : "")).toLowerCase();
  if (provider !== "cashfree") return null;
  const clientId = env.CASHFREE_CLIENT_ID?.trim(), clientSecret = env.CASHFREE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return createCashfreeVerifier({ clientId, clientSecret, environment: env.CASHFREE_ENV?.trim() === "production" ? "production" : "sandbox", apiVersion: env.CASHFREE_API_VERSION?.trim() || undefined, fetch: doFetch });
}
