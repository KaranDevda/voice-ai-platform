import type { CheckResult, DeviceCall, LeadOption, SyncOutcome } from "./types";

/** The server said the pairing is no longer valid (phone revoked, person suspended). The app must forget the pairing and ask to pair again. */
export class UnpairedError extends Error { constructor() { super("This phone is no longer linked. Link it again with a new code."); this.name = "UnpairedError"; } }
/** The server could not be reached or had a temporary problem. Nothing is lost: the app tries again later. */
export class NetworkError extends Error { constructor(message: string) { super(message); this.name = "NetworkError"; } }
/** The server refused the request itself (bad code, too many attempts). */
export class RequestError extends Error { constructor(message: string, public status: number, public code: string) { super(message); this.name = "RequestError"; } }

export interface ApiOptions { baseUrl: string; token?: string; fetch?: typeof fetch; timeoutMs?: number }

export function createApi(o: ApiOptions) {
  const f = o.fetch ?? fetch;
  const base = o.baseUrl.replace(/\/+$/, "");

  async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    let res: Response;
    try {
      res = await f(`${base}${path}`, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers: { "content-type": "application/json", ...(o.token ? { authorization: `Bearer ${o.token}` } : {}) },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(o.timeoutMs ?? 20_000),
      });
    } catch (e) {
      throw new NetworkError(e instanceof Error ? e.message : "network error");
    }
    if (res.status === 401 && o.token) throw new UnpairedError();
    if (res.status >= 500 || (res.status === 429 && o.token)) throw new NetworkError(`server answered ${res.status}`);
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new RequestError(typeof body.message === "string" ? body.message : `request failed (${res.status})`, res.status, String(body.error ?? "error"));
    return body as T;
  }

  return {
    /** Trades the code from the website for a device token. */
    register: (input: { code: string; fingerprint: string; platform: "android" | "ios"; name?: string; appVersion?: string; workSimSlot?: number }) =>
      call<{ deviceId: string; token: string; email: string }>("/api/mobile/register", { body: input }),
    me: () => call<{ deviceId: string; calling: { windowStart: string; windowEnd: string } }>("/api/mobile/me"),
    leads: async () => (await call<{ leads: LeadOption[] }>("/api/mobile/leads")).leads,
    check: (target: { leadId?: string; number?: string }) => call<CheckResult>("/api/mobile/check-call", { body: target }),
    syncCalls: async (calls: DeviceCall[]) => (await call<{ results: SyncOutcome[] }>("/api/mobile/calls", { body: { calls } })).results,
  };
}
export type Api = ReturnType<typeof createApi>;
