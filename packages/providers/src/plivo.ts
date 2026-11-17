import { createHmac, timingSafeEqual } from "node:crypto";
import { ProviderError } from "./types";

/**
 * Plivo, the phone carrier. Written from Plivo's documentation and the signature code in its own Python library; it has NOT yet been
 * run against a real Plivo account or number (that waits on the carrier's KYC), so the first live call may need small fixes.
 */

// ---------------------------------------------------------------------------------------------- signatures

type Params = Record<string, string | string[]>;

/** The text Plivo signs for a request to `url` (the PUBLIC address Plivo called, not an internal one). Plivo's "V3" scheme. */
function signedText(method: "GET" | "POST", url: string, params: Params, nonce: string): string {
  const u = new URL(url);
  const hadQuery = u.search.length > 1;
  const pairs = (p: Params) => Object.entries(p).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).flatMap(([k, v]) => (Array.isArray(v) ? [...v].sort().map((x) => [k, x] as const) : [[k, v] as const]));
  const query: Params = {};
  u.searchParams.forEach((v, k) => { query[k] = k in query ? [...[query[k]!].flat(), v] : v; });
  let base = `${u.origin}${u.pathname}`;
  if (method === "GET") {
    const all = pairs({ ...query, ...params }).map(([k, v]) => `${k}=${v}`).join("&");
    if (all) base += `?${all}`;
    if (hadQuery) base += ".";
  } else {
    if (hadQuery) base += `?${pairs(query).map(([k, v]) => `${k}=${v}`).join("&")}.`;
    base += pairs(params).map(([k, v]) => `${k}${v}`).join("");
  }
  return `${base}.${nonce}`;
}

export function plivoSignatureV3(o: { method?: "GET" | "POST"; url: string; params?: Params; nonce: string; authToken: string }): string {
  return createHmac("sha256", o.authToken).update(signedText(o.method ?? "POST", o.url, o.params ?? {}, o.nonce)).digest("base64");
}

/** True when `header` (X-Plivo-Signature-V3, possibly several signatures separated by commas) matches the request. */
export function verifyPlivoSignature(o: { method?: "GET" | "POST"; url: string; params?: Params; nonce: string | undefined; header: string | undefined; authToken: string }): boolean {
  if (!o.nonce || !o.header || !o.authToken) return false;
  const expected = Buffer.from(plivoSignatureV3({ ...o, nonce: o.nonce }));
  return o.header.split(",").some((s) => {
    const got = Buffer.from(s.trim());
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

// ---------------------------------------------------------------------------------------------- call XML

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** Tells Plivo to open a two-way audio stream (8 kHz µ-law) to our server and keep the call up while it is open. */
export const plivoStreamXml = (streamUrl: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><Response><Stream bidirectional="true" keepCallAlive="true" contentType="audio/x-mulaw;rate=8000">${esc(streamUrl)}</Stream></Response>`;

/** Hands the call to a person's phone number. Optional timeout/action let the caller receive a result if nobody answers. */
export const plivoDialXml = (toNumber: string, options?: { timeoutS?: number; actionUrl?: string }) =>
  `<?xml version="1.0" encoding="UTF-8"?><Response><Dial${options?.timeoutS ? ` timeout="${Math.max(10, Math.min(120, Math.trunc(options.timeoutS)))}"` : ""}${options?.actionUrl ? ` action="${esc(options.actionUrl)}" method="POST" redirect="true"` : ""}><Number>${esc(toNumber)}</Number></Dial></Response>`;
/** Speaks a brief handoff outcome and then ends a call. */
export const plivoSpeakHangupXml = (text: string) => `<?xml version="1.0" encoding="UTF-8"?><Response><Speak>${esc(text.slice(0, 500))}</Speak><Hangup/></Response>`;

/**
 * A touch-tone menu: plays the prompt (an audio file made by our own voice) and waits for one key. The key goes to `actionUrl`; with no key
 * the call carries on to `fallbackUrl` (the AI), so a caller who presses nothing is never stuck.
 */
export const plivoMenuXml = (o: { audioUrl: string; actionUrl: string; fallbackUrl: string; validDigits: string; timeoutS?: number }) =>
  `<?xml version="1.0" encoding="UTF-8"?><Response><GetDigits action="${esc(o.actionUrl)}" method="POST" numDigits="1" timeout="${o.timeoutS ?? 6}" retries="1" validDigits="${esc(o.validDigits)}"><Play>${esc(o.audioUrl)}</Play></GetDigits><Redirect method="POST">${esc(o.fallbackUrl)}</Redirect></Response>`;

/** Plays an audio file (given by address) to the person who answered, then ends the call. */
export const plivoPlayXml = (audioUrl: string) => `<?xml version="1.0" encoding="UTF-8"?><Response><Play>${esc(audioUrl)}</Play><Hangup/></Response>`;
export const plivoHangupXml = () => `<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`;

// ---------------------------------------------------------------------------------------------- the audio stream

export type PlivoStreamEvent =
  | { type: "start"; callId: string; streamId: string }
  | { type: "media"; audio: Uint8Array }
  | { type: "stop" }
  | { type: "other"; event: string };

/** One message from Plivo on the audio WebSocket. Returns null for anything that is not a well-formed message. */
export function parsePlivoStreamMessage(raw: string): PlivoStreamEvent | null {
  let m: Record<string, any>;
  try { m = JSON.parse(raw); } catch { return null; }
  if (!m || typeof m.event !== "string") return null;
  if (m.event === "start") {
    const s = m.start ?? {};
    const callId = s.callId ?? s.call_id ?? s.callUUID ?? "", streamId = s.streamId ?? s.stream_id ?? m.streamId ?? "";
    return { type: "start", callId: String(callId), streamId: String(streamId) };
  }
  if (m.event === "media") {
    const payload = m.media?.payload;
    if (typeof payload !== "string") return null;
    return { type: "media", audio: new Uint8Array(Buffer.from(payload, "base64")) };
  }
  if (m.event === "stop") return { type: "stop" };
  return { type: "other", event: m.event };
}

/** Audio for the caller to hear. Must match the stream's format: 8 kHz µ-law. */
export const plivoPlayAudio = (mulaw: Uint8Array) =>
  JSON.stringify({ event: "playAudio", media: { contentType: "audio/x-mulaw", sampleRate: 8000, payload: Buffer.from(mulaw).toString("base64") } });

/** Throws away audio Plivo has queued but not yet played: used when the caller interrupts. */
export const plivoClearAudio = (streamId: string) => JSON.stringify({ event: "clearAudio", streamId });

// ---------------------------------------------------------------------------------------------- REST API

export interface PlivoConfig { authId: string; authToken: string; fetch?: typeof fetch; baseUrl?: string }

export interface PlivoAvailableNumber {
  number: string; type: string; subType: string; city: string | null; region: string | null;
  monthlyRentalRate: string | null; setupRate: string | null; voiceEnabled: boolean; smsEnabled: boolean;
  restriction: string | null; restrictionText: string | null;
}

export function createPlivo(config: PlivoConfig) {
  const f = config.fetch ?? fetch;
  const base = `${config.baseUrl ?? "https://api.plivo.com"}/v1/Account/${encodeURIComponent(config.authId)}`;
  const headers = { authorization: `Basic ${Buffer.from(`${config.authId}:${config.authToken}`).toString("base64")}`, "content-type": "application/json" };

  async function call(method: string, path: string, body?: unknown): Promise<Record<string, any>> {
    const res = await f(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    const json = text ? (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })() : {};
    if (!res.ok) throw new ProviderError(`Plivo ${method} ${path} failed (${res.status}): ${String(json.error ?? json.message ?? text).slice(0, 200)}`, res.status, "plivo");
    return json;
  }

  return {
    /** Search Plivo's live inventory. A search is read-only and never rents a number. */
    async searchNumbers(i: { countryIso: string; type?: "local" | "tollfree" | "mobile" | "national" | "fixed"; pattern?: string; city?: string; region?: string; services?: "voice" | "sms" | "voice,sms"; limit?: number; offset?: number }): Promise<PlivoAvailableNumber[]> {
      const query = new URLSearchParams({ country_iso: i.countryIso.toUpperCase(), limit: String(i.limit ?? 20), offset: String(i.offset ?? 0) });
      if (i.type) query.set("type", i.type);
      if (i.pattern) query.set("pattern", i.pattern);
      if (i.city) query.set("city", i.city);
      if (i.region) query.set("region", i.region);
      if (i.services) query.set("services", i.services);
      const r = await call("GET", `/PhoneNumber/?${query.toString()}`);
      const objects = Array.isArray(r.objects) ? r.objects as Record<string, unknown>[] : [];
      return objects.flatMap((x) => {
        if (typeof x.number !== "string") return [];
        return [{
          number: x.number, type: String(x.type ?? ""), subType: String(x.sub_type ?? ""),
          city: typeof x.city === "string" ? x.city : null, region: typeof x.region === "string" ? x.region : null,
          monthlyRentalRate: typeof x.monthly_rental_rate === "string" ? x.monthly_rental_rate : null,
          setupRate: typeof x.setup_rate === "string" ? x.setup_rate : null,
          voiceEnabled: x.voice_enabled === true, smsEnabled: x.sms_enabled === true,
          restriction: typeof x.restriction === "string" ? x.restriction : null,
          restrictionText: typeof x.restriction_text === "string" ? x.restriction_text : null,
        }];
      });
    },
    /** Rents one number from Plivo. This can incur setup and recurring fees. */
    async buyNumber(i: { number: string; appId?: string; complianceApplicationId?: string }): Promise<{ number: string; status: string }> {
      const number = i.number.replace(/^\+/, "");
      const payload = {
        ...(i.appId ? { app_id: i.appId } : {}), ...(i.complianceApplicationId ? { compliance_application_id: i.complianceApplicationId } : {}),
      };
      const r = await call("POST", `/PhoneNumber/${encodeURIComponent(number)}/`, Object.keys(payload).length ? payload : undefined);
      const bought = Array.isArray(r.numbers) ? r.numbers.find((n: Record<string, unknown>) => String(n.number ?? "") === number) : undefined;
      const status = String(bought?.status ?? r.status ?? "");
      if (!bought && !/fulfilled|success/i.test(status)) throw new ProviderError("Plivo did not confirm the number purchase", 502, "plivo");
      return { number: `+${number}`, status: status || "Success" };
    },
    /** Places an outbound call. When the person answers, Plivo fetches `answerUrl` for instructions. Returns Plivo's id for the call. */
    async makeCall(i: { from: string; to: string; answerUrl: string; hangupUrl?: string; machineUrl?: string }): Promise<{ callUuid: string }> {
      // machineUrl: Plivo listens for an answering machine and posts the result there (Machine=true or false) a few seconds after answer.
      const r = await call("POST", "/Call/", {
        from: i.from, to: i.to, answer_url: i.answerUrl, answer_method: "POST",
        ...(i.hangupUrl ? { hangup_url: i.hangupUrl, hangup_method: "POST" } : {}),
        ...(i.machineUrl ? { machine_detection: "true", machine_detection_time: 5000, machine_detection_url: i.machineUrl, machine_detection_method: "POST" } : {}),
      });
      const id = Array.isArray(r.request_uuid) ? r.request_uuid[0] : r.request_uuid;
      return { callUuid: String(id ?? "") };
    },
    /** Sends one text. Plivo currently routes India SMS over ILDO; its domestic DLT request fields are deprecated. */
    async sendSms(i: { from: string; to: string; text: string }): Promise<{ messageUuid: string }> {
      const r = await call("POST", "/Message/", {
        src: i.from, dst: i.to, text: i.text, type: "sms",
      });
      const id = Array.isArray(r.message_uuid) ? r.message_uuid[0] : r.message_uuid;
      return { messageUuid: String(id ?? "") };
    },
    /** Moves a live call to new instructions: Plivo fetches `legUrl`, which should answer with plivoDialXml(person's number). */
    async transferCall(i: { callUuid: string; legUrl: string }): Promise<void> {
      await call("POST", `/Call/${encodeURIComponent(i.callUuid)}/`, { legs: "aleg", aleg_url: i.legUrl, aleg_method: "POST" });
    },
    async hangup(callUuid: string): Promise<void> {
      await call("DELETE", `/Call/${encodeURIComponent(callUuid)}/`);
    },
  };
}
export type Plivo = ReturnType<typeof createPlivo>;
