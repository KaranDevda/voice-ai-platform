import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { connect, isIP } from "node:net";
import { ProviderError } from "./types";
import type { PlivoAvailableNumber } from "./plivo";

// ---------------------------------------------------------------------------------------------- webhook signature

/** Twilio's `X-Twilio-Signature`: base64 HMAC-SHA1 of the full URL followed by each POST parameter (sorted by name) as name+value. */
export function twilioSignature(o: { url: string; params?: Record<string, string>; authToken: string }): string {
  const data = o.url + Object.keys(o.params ?? {}).sort().map((k) => k + (o.params![k] ?? "")).join("");
  return createHmac("sha1", o.authToken).update(data).digest("base64");
}
export function verifyTwilioSignature(o: { url: string; params?: Record<string, string>; header: string | undefined; authToken: string }): boolean {
  if (!o.header) return false;
  const want = Buffer.from(twilioSignature(o)), got = Buffer.from(o.header);
  return want.length === got.length && timingSafeEqual(want, got);
}

// ---------------------------------------------------------------------------------------------- trunk health (pure)

export type TrunkHealthStatus = "ok" | "degraded" | "down";
export interface TrunkHealthCheck { name: string; status: TrunkHealthStatus; detail: string }
export interface TrunkHealthInput {
  trunkFound: boolean;
  terminationDomain: string | null;
  /** How many credential lists / IP access lists are attached: outbound calls need at least one. */
  credentialLists: number; ipAccessLists: number;
  origination: Array<{ sipUrl: string; enabled: boolean; reachable: boolean | null }>;
  numbers: number;
  /** Calls through this trunk in the sample window, and how many ended failed/busy/no-answer/canceled by the network. */
  callSample: { total: number; failed: number } | null;
}
export interface TrunkHealth { status: TrunkHealthStatus; checks: TrunkHealthCheck[] }
const RANK: Record<TrunkHealthStatus, number> = { ok: 0, degraded: 1, down: 2 };

/** Turns what was measured into one verdict. Pure, so every rule is unit-tested. */
export function computeTrunkHealth(i: TrunkHealthInput): TrunkHealth {
  const checks: TrunkHealthCheck[] = [];
  const add = (name: string, status: TrunkHealthStatus, detail: string) => checks.push({ name, status, detail });
  if (!i.trunkFound) {
    add("trunk", "down", "The trunk no longer exists at Twilio.");
    return { status: "down", checks };
  }
  add("trunk", "ok", "The trunk exists at Twilio.");
  if (!i.terminationDomain) add("termination", "degraded", "No termination domain is set, so outbound calls cannot be sent through this trunk.");
  else if (i.credentialLists + i.ipAccessLists === 0) add("termination", "degraded", `${i.terminationDomain} has no credential list or IP access list: Twilio will refuse outbound SIP from your PBX.`);
  else add("termination", "ok", `${i.terminationDomain} accepts outbound SIP (${i.credentialLists} credential list(s), ${i.ipAccessLists} IP access list(s)).`);

  const enabled = i.origination.filter((o) => o.enabled);
  if (enabled.length === 0) add("origination", "degraded", "No enabled origination URL: inbound calls to your numbers have nowhere to go.");
  else {
    const probed = enabled.filter((o) => o.reachable !== null), down = probed.filter((o) => o.reachable === false);
    if (probed.length === 0) add("origination", "ok", `${enabled.length} origination URL(s) configured (reachability not tested).`);
    else if (down.length === probed.length) add("origination", "down", `None of your ${probed.length} SIP endpoint(s) answered: ${down.map((o) => o.sipUrl).join(", ")}.`);
    else if (down.length > 0) add("origination", "degraded", `${down.length} of ${probed.length} SIP endpoint(s) did not answer: ${down.map((o) => o.sipUrl).join(", ")}.`);
    else add("origination", "ok", `All ${probed.length} SIP endpoint(s) answered.`);
  }
  add("numbers", i.numbers > 0 ? "ok" : "degraded", i.numbers > 0 ? `${i.numbers} number(s) route through this trunk.` : "No phone number is attached to this trunk.");

  const s = i.callSample;
  if (!s || s.total < 10) add("calls", "ok", s ? `Only ${s.total} call(s) in the last 24 hours: too few to judge.` : "Recent calls could not be read.");
  else {
    const rate = s.failed / s.total, pct = `${Math.round(rate * 100)}% of ${s.total} calls in the last 24 hours failed`;
    add("calls", rate >= 0.5 ? "down" : rate >= 0.2 ? "degraded" : "ok", rate >= 0.2 ? `${pct}.` : `${pct} (normal).`);
  }
  return { status: checks.reduce<TrunkHealthStatus>((w, c) => (RANK[c.status] > RANK[w] ? c.status : w), "ok"), checks };
}

/** True when something accepts a TCP connection at the SIP address (sip:host[:port]). A reachability hint, not a SIP conversation. */
export function probeSipEndpoint(sipUrl: string, timeoutMs = 4000): Promise<boolean> {
  const m = /^sips?:(?:[^@/]*@)?(\[[^\]]+\]|[^:;/?]+)(?::(\d+))?/i.exec(sipUrl.trim());
  if (!m) return Promise.resolve(false);
  const host = m[1]!.replace(/^\[|\]$/g, ""), port = m[2] ? Number(m[2]) : /^sips:/i.test(sipUrl) ? 5061 : 5060;
  return (async () => {
    // The address is typed by a customer: never let the probe reach into our own network.
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
    if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) return false;
    return new Promise<boolean>((resolve) => {
      const s = connect({ host: addrs[0]!.address, port, timeout: timeoutMs });
      const done = (ok: boolean) => { s.destroy(); resolve(ok); };
      s.once("connect", () => done(true)); s.once("timeout", () => done(false)); s.once("error", () => done(false));
    });
  })();
}
/** Loopback, private, link-local and other non-public addresses (IPv4 and IPv6). */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0);
  }
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb");
}

// ---------------------------------------------------------------------------------------------- REST API

export interface TwilioConfig { accountSid: string; authToken: string; fetch?: typeof fetch; baseUrl?: string; trunkingBaseUrl?: string; pricingBaseUrl?: string }
export interface TwilioTrunk { sid: string; name: string; domainName: string | null; secure: boolean }
export type TwilioNumberType = "local" | "tollfree" | "mobile";
const TYPE_PATH: Record<TwilioNumberType, string> = { local: "Local", tollfree: "TollFree", mobile: "Mobile" };

export function createTwilio(config: TwilioConfig) {
  const f = config.fetch ?? fetch;
  const sid = encodeURIComponent(config.accountSid);
  const api = `${config.baseUrl ?? "https://api.twilio.com"}/2010-04-01/Accounts/${sid}`;
  const trunking = `${config.trunkingBaseUrl ?? "https://trunking.twilio.com"}/v1`;
  const pricing = `${config.pricingBaseUrl ?? "https://pricing.twilio.com"}/v1`;
  const auth = `Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64")}`;

  async function call(method: string, url: string, form?: Record<string, string | undefined>): Promise<Record<string, any>> {
    const body = form ? new URLSearchParams(Object.entries(form).filter((e): e is [string, string] => e[1] !== undefined)).toString() : undefined;
    const res = await f(url, { method, headers: { authorization: auth, ...(body !== undefined ? { "content-type": "application/x-www-form-urlencoded" } : {}) }, body, signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    const json = text ? (() => { try { return JSON.parse(text); } catch { return { raw: text }; } })() : {};
    const path = url.replace(/^https:\/\/[^/]+/, "").replace(/\?.*$/, "");
    if (!res.ok) throw new ProviderError(`Twilio ${method} ${path} failed (${res.status}): ${String(json.message ?? json.error ?? text).slice(0, 200)}`, res.status, "twilio");
    return json;
  }
  const str = (v: unknown) => (typeof v === "string" ? v : null);

  const self = {
    /** Monthly price per number type for a country, from Twilio's pricing API (null when not listed). */
    async numberPrices(countryIso: string): Promise<Partial<Record<TwilioNumberType, string>>> {
      const r = await call("GET", `${pricing}/PhoneNumbers/Countries/${encodeURIComponent(countryIso.toUpperCase())}`).catch((): Record<string, any> => ({}));
      const out: Partial<Record<TwilioNumberType, string>> = {};
      for (const p of Array.isArray(r.phone_number_prices) ? r.phone_number_prices : []) {
        const t = String(p.number_type ?? "").replace(/[^a-z]/gi, "").toLowerCase();
        const price = str(p.current_price) ?? str(p.base_price);
        if (price && (t === "local" || t === "tollfree" || t === "mobile")) out[t] = price;
      }
      return out;
    },
    /** Searches Twilio's live inventory (read-only). Same shape as Plivo's, so one screen serves both carriers. */
    async searchNumbers(i: { countryIso: string; type?: "local" | "tollfree" | "mobile" | "national" | "fixed"; pattern?: string; city?: string; region?: string; services?: "voice" | "sms" | "voice,sms"; limit?: number; offset?: number }): Promise<PlivoAvailableNumber[]> {
      const type: TwilioNumberType = i.type === "tollfree" ? "tollfree" : i.type === "mobile" ? "mobile" : "local";
      const q = new URLSearchParams({ PageSize: String(i.limit ?? 20) });
      if (i.pattern) q.set("Contains", i.pattern);
      if (i.city && type === "local") q.set("InLocality", i.city);
      if (i.region && type === "local") q.set("InRegion", i.region);
      if (i.services?.includes("voice")) q.set("VoiceEnabled", "true");
      if (i.services?.includes("sms")) q.set("SmsEnabled", "true");
      const [r, prices] = await Promise.all([call("GET", `${api}/AvailablePhoneNumbers/${encodeURIComponent(i.countryIso.toUpperCase())}/${TYPE_PATH[type]}.json?${q}`), self.numberPrices(i.countryIso)]);
      const items = Array.isArray(r.available_phone_numbers) ? r.available_phone_numbers as Record<string, any>[] : [];
      return items.flatMap((x) => {
        if (typeof x.phone_number !== "string") return [];
        const need = typeof x.address_requirements === "string" && x.address_requirements !== "none" ? x.address_requirements : undefined;
        return [{
          number: x.phone_number, type, subType: type, city: str(x.locality), region: str(x.region),
          monthlyRentalRate: prices[type] ?? null, setupRate: null,
          voiceEnabled: x.capabilities?.voice === true, smsEnabled: x.capabilities?.SMS === true || x.capabilities?.sms === true,
          restriction: need ?? null, restrictionText: need ? `Twilio requires a ${need} address (a regulatory bundle or address) for this number.` : null,
        }];
      });
    },
    /** Rents one number. This can incur recurring fees. `addressSid`/`bundleSid` are needed for countries with regulations. */
    async buyNumber(i: { number: string; voiceUrl?: string; smsUrl?: string; addressSid?: string; bundleSid?: string }): Promise<{ number: string; status: string; sid: string }> {
      const r = await call("POST", `${api}/IncomingPhoneNumbers.json`, {
        PhoneNumber: i.number.startsWith("+") ? i.number : `+${i.number}`, VoiceUrl: i.voiceUrl, SmsUrl: i.smsUrl, AddressSid: i.addressSid, BundleSid: i.bundleSid,
      });
      if (typeof r.sid !== "string" || typeof r.phone_number !== "string") throw new ProviderError("Twilio did not confirm the number purchase", 502, "twilio");
      return { number: r.phone_number, status: "Success", sid: r.sid };
    },
    async incomingNumberSid(e164: string): Promise<string | null> {
      const r = await call("GET", `${api}/IncomingPhoneNumbers.json?${new URLSearchParams({ PhoneNumber: e164, PageSize: "1" })}`);
      return str(r.incoming_phone_numbers?.[0]?.sid);
    },
    async makeCall(i: { from: string; to: string; answerUrl: string; hangupUrl?: string }): Promise<{ callSid: string }> {
      const r = await call("POST", `${api}/Calls.json`, { From: i.from, To: i.to, Url: i.answerUrl, Method: "POST", StatusCallback: i.hangupUrl, StatusCallbackMethod: i.hangupUrl ? "POST" : undefined });
      return { callSid: String(r.sid ?? "") };
    },
    async sendSms(i: { from: string; to: string; text: string }): Promise<{ messageSid: string }> {
      const r = await call("POST", `${api}/Messages.json`, { From: i.from, To: i.to, Body: i.text });
      return { messageSid: String(r.sid ?? "") };
    },

    // ---- Elastic SIP Trunking (BYOC)
    async createTrunk(i: { name: string; domainName?: string; secure?: boolean }): Promise<TwilioTrunk> {
      return self.mapTrunk(await call("POST", `${trunking}/Trunks`, { FriendlyName: i.name, DomainName: i.domainName, Secure: i.secure === undefined ? undefined : String(i.secure) }));
    },
    mapTrunk(r: Record<string, any>): TwilioTrunk { return { sid: String(r.sid), name: String(r.friendly_name ?? ""), domainName: str(r.domain_name), secure: r.secure === true }; },
    async getTrunk(trunkSid: string): Promise<TwilioTrunk | null> {
      try { return self.mapTrunk(await call("GET", `${trunking}/Trunks/${encodeURIComponent(trunkSid)}`)); } catch (e) { if (e instanceof ProviderError && e.status === 404) return null; throw e; }
    },
    async listTrunks(): Promise<TwilioTrunk[]> {
      const r = await call("GET", `${trunking}/Trunks?PageSize=100`);
      return (Array.isArray(r.trunks) ? r.trunks : []).map(self.mapTrunk);
    },
    async deleteTrunk(trunkSid: string): Promise<void> { await call("DELETE", `${trunking}/Trunks/${encodeURIComponent(trunkSid)}`); },
    /** Where Twilio sends calls that arrive on your numbers: your own carrier or PBX (a sip: or sips: address). */
    async addOriginationUrl(trunkSid: string, i: { name: string; sipUrl: string; priority?: number; weight?: number; enabled?: boolean }): Promise<{ sid: string }> {
      const r = await call("POST", `${trunking}/Trunks/${encodeURIComponent(trunkSid)}/OriginationUrls`, { FriendlyName: i.name, SipUrl: i.sipUrl, Priority: String(i.priority ?? 10), Weight: String(i.weight ?? 10), Enabled: String(i.enabled ?? true) });
      return { sid: String(r.sid) };
    },
    async listOriginationUrls(trunkSid: string): Promise<Array<{ sid: string; name: string; sipUrl: string; enabled: boolean }>> {
      const r = await call("GET", `${trunking}/Trunks/${encodeURIComponent(trunkSid)}/OriginationUrls`);
      return (Array.isArray(r.origination_urls) ? r.origination_urls : []).map((o: Record<string, any>) => ({ sid: String(o.sid), name: String(o.friendly_name ?? ""), sipUrl: String(o.sip_url ?? ""), enabled: o.enabled !== false }));
    },
    /** Outbound from your PBX: allow its IP address (or range) to send calls to the trunk's termination domain. */
    async allowIp(trunkSid: string, i: { name: string; ip: string; cidrPrefix?: number }): Promise<{ aclSid: string }> {
      const acl = await call("POST", `${api}/SIP/IpAccessControlLists.json`, { FriendlyName: i.name });
      await call("POST", `${api}/SIP/IpAccessControlLists/${encodeURIComponent(String(acl.sid))}/IpAddresses.json`, { FriendlyName: i.name, IpAddress: i.ip, CidrPrefixLength: i.cidrPrefix === undefined ? undefined : String(i.cidrPrefix) });
      await call("POST", `${trunking}/Trunks/${encodeURIComponent(trunkSid)}/IpAccessControlLists`, { IpAccessControlListSid: String(acl.sid) });
      return { aclSid: String(acl.sid) };
    },
    /** Outbound from your PBX with a username and password instead of an IP address. */
    async addCredential(trunkSid: string, i: { name: string; username: string; password: string }): Promise<{ listSid: string }> {
      const list = await call("POST", `${api}/SIP/CredentialLists.json`, { FriendlyName: i.name });
      await call("POST", `${api}/SIP/CredentialLists/${encodeURIComponent(String(list.sid))}/Credentials.json`, { Username: i.username, Password: i.password });
      await call("POST", `${trunking}/Trunks/${encodeURIComponent(trunkSid)}/CredentialLists`, { CredentialListSid: String(list.sid) });
      return { listSid: String(list.sid) };
    },
    async attachNumber(trunkSid: string, phoneNumberSid: string): Promise<void> {
      await call("POST", `${trunking}/Trunks/${encodeURIComponent(trunkSid)}/PhoneNumbers`, { PhoneNumberSid: phoneNumberSid });
    },
    async detachNumber(trunkSid: string, phoneNumberSid: string): Promise<void> {
      await call("DELETE", `${trunking}/Trunks/${encodeURIComponent(trunkSid)}/PhoneNumbers/${encodeURIComponent(phoneNumberSid)}`);
    },

    /** Reads the trunk's live configuration, tests each origination endpoint, samples the last day of calls, and gives a verdict. */
    async trunkHealth(trunkSid: string, o?: { probe?: (sipUrl: string) => Promise<boolean>; now?: Date }): Promise<TrunkHealth & { checkedAt: string }> {
      const now = o?.now ?? new Date(), probe = o?.probe ?? probeSipEndpoint;
      const list = async (path: string, key: string) => { const r = await call("GET", `${trunking}/Trunks/${encodeURIComponent(trunkSid)}/${path}`).catch((e) => { if (e instanceof ProviderError && e.status === 404) return null; throw e; }); return r && Array.isArray(r[key]) ? r[key] as unknown[] : []; };
      const trunk = await self.getTrunk(trunkSid);
      if (!trunk) return { ...computeTrunkHealth({ trunkFound: false, terminationDomain: null, credentialLists: 0, ipAccessLists: 0, origination: [], numbers: 0, callSample: null }), checkedAt: now.toISOString() };
      const [urls, creds, acls, nums] = await Promise.all([self.listOriginationUrls(trunkSid), list("CredentialLists", "credential_lists"), list("IpAccessControlLists", "ip_access_control_lists"), list("PhoneNumbers", "phone_numbers")]);
      const origination = await Promise.all(urls.map(async (u) => ({ sipUrl: u.sipUrl, enabled: u.enabled, reachable: u.enabled ? await probe(u.sipUrl).catch(() => false) : null })));
      const since = new Date(now.getTime() - 24 * 3600_000).toISOString().slice(0, 10);
      const callSample = await call("GET", `${api}/Calls.json?${new URLSearchParams({ "StartTime>": since, PageSize: "200" })}`).then((r) => {
        const calls = (Array.isArray(r.calls) ? r.calls as Record<string, any>[] : []).filter((c) => c.trunk_sid === trunkSid);
        return { total: calls.length, failed: calls.filter((c) => c.status === "failed" || c.status === "busy" || c.status === "no-answer").length };
      }).catch(() => null);
      const health = computeTrunkHealth({ trunkFound: true, terminationDomain: trunk.domainName, credentialLists: creds.length, ipAccessLists: acls.length, origination, numbers: nums.length, callSample });
      return { ...health, checkedAt: now.toISOString() };
    },
  };
  return self;
}
export type Twilio = ReturnType<typeof createTwilio>;
