import { createHmac, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Sending events to an organisation's CRM. Every request is signed so the receiver can tell it is genuine and fresh, and the address is
 * checked so nobody can point a webhook at our own network (internal services, cloud metadata) and read what comes back.
 */

/** True for addresses that are not on the public internet: loopback, private, link-local (cloud metadata), carrier-grade NAT, unspecified, multicast. */
export function isPrivateIp(ip: string): boolean {
  const v = ip.toLowerCase();
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || a >= 224;
  }
  if (isIP(v) === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateIp(mapped[1]!);
    return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
  }
  return true; // not an address at all: treat as unsafe
}

export class UnsafeUrlError extends Error {}

/** Throws unless `url` is an https address whose host resolves only to public addresses. `resolve` is injectable for tests. */
export async function assertPublicUrl(url: string, resolve: (host: string) => Promise<string[]> = async (h) => (await lookup(h, { all: true })).map((a) => a.address)): Promise<URL> {
  let u: URL;
  try { u = new URL(url); } catch { throw new UnsafeUrlError("that is not a valid web address"); }
  if (u.protocol !== "https:") throw new UnsafeUrlError("the address must start with https://");
  if (u.username || u.password) throw new UnsafeUrlError("the address must not contain a username or password");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new UnsafeUrlError("that address points inside a private network");
  const addrs = isIP(host) ? [host] : await resolve(host).catch(() => { throw new UnsafeUrlError("that address could not be found"); });
  if (addrs.length === 0 || addrs.some(isPrivateIp)) throw new UnsafeUrlError("that address points inside a private network");
  return u;
}

const sign = (secret: string, ts: string, body: string) => createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");

/** For the receiver: is this request ours, and not older than `toleranceS`? The header looks like "sha256=<hex>". */
export function verifyCrmSignature(rawBody: string, timestamp: string | null | undefined, header: string | null | undefined, secret: string, nowS = Math.floor(Date.now() / 1000), toleranceS = 300): boolean {
  if (!timestamp || !header || !/^\d+$/.test(timestamp) || Math.abs(nowS - Number(timestamp)) > toleranceS) return false;
  const want = Buffer.from(`sha256=${sign(secret, timestamp, rawBody)}`), got = Buffer.from(header.trim());
  return want.length === got.length && timingSafeEqual(want, got);
}

export interface CrmDelivery { id: string; event: string; payload: unknown; url: string; secret: string }

/** One attempt. Success is any 2xx. Redirects are not followed (they could lead somewhere private). The address is re-checked now, not trusted from when it was saved. */
export async function sendCrmWebhook(d: CrmDelivery, o: { fetch?: typeof fetch; resolve?: (host: string) => Promise<string[]>; now?: () => number } = {}): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  try { await assertPublicUrl(d.url, o.resolve); } catch (e) { return { ok: false, status: null, error: e instanceof Error ? e.message : "unsafe address" }; }
  const body = JSON.stringify(d.payload), ts = String(Math.floor((o.now?.() ?? Date.now()) / 1000));
  try {
    const res = await (o.fetch ?? fetch)(d.url, {
      method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000), body,
      headers: { "content-type": "application/json", "user-agent": "BizfyVoiceAI-Webhooks/1", "x-voiceai-event": d.event, "x-voiceai-delivery": d.id, "x-voiceai-timestamp": ts, "x-voiceai-signature": `sha256=${sign(d.secret, ts, body)}` },
    });
    const ok = res.status >= 200 && res.status < 300;
    return { ok, status: res.status, error: ok ? null : res.status >= 300 && res.status < 400 ? `the address redirected (${res.status}); redirects are not followed` : `the receiver answered ${res.status}` };
  } catch (e) {
    return { ok: false, status: null, error: e instanceof Error && e.name === "TimeoutError" ? "no answer within 10 seconds" : `could not reach it: ${e instanceof Error ? e.message : e}`.slice(0, 200) };
  }
}
