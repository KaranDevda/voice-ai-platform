import { describe, expect, it } from "vitest";
import { deviceCallSchema, registerDeviceSchema, splitSyncBatch } from "@voiceai/shared";
import { createApi, NetworkError, RequestError, UnpairedError } from "./api";
import { fromAndroid, newestTimestamp, readFrom, type AndroidCallEntry } from "./calllog";
import { backoffSeconds, BATCH, MAX_QUEUE, SyncQueue } from "./queue";
import type { DeviceCall, KeyValueStore, SyncOutcome } from "./types";

const memory = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v), remove: async (k) => void data.delete(k) };
};
const call = (n: number): DeviceCall => ({ localId: `c${n}`, number: "+919800000001", direction: "outbound", status: "connected", startedAt: "2026-10-26T04:30:00.000Z", durationS: n });
const fakeApi = (handler: (calls: DeviceCall[]) => Promise<SyncOutcome[]>) => ({ syncCalls: handler }) as unknown as Parameters<SyncQueue["flush"]>[0];
const saved = (calls: DeviceCall[]): SyncOutcome[] => calls.map((c) => ({ localId: c.localId, result: "saved" }));

describe("the app and the server agree on the data", () => {
  it("a call the app builds passes the server's own check", () => {
    const entry: AndroidCallEntry = { phoneNumber: "+91 98765 43210", rawType: 2, timestamp: 1_792_000_000_000, duration: 61, phoneAccountId: "8991" };
    const c = fromAndroid(entry, "8991")!;
    expect(deviceCallSchema.safeParse(c).success).toBe(true);
    expect(splitSyncBatch([c]).valid).toHaveLength(1);
  });
  it("a registration the app builds passes the server's own check", () => {
    expect(registerDeviceSchema.safeParse({ code: "ABCD-2345", fingerprint: "x".repeat(32), platform: "ios", name: "iPhone", appVersion: "1.0.0" }).success).toBe(true);
  });
});

describe("Android call log", () => {
  const e = (over: Partial<AndroidCallEntry> = {}): AndroidCallEntry => ({ phoneNumber: "9800000001", rawType: 2, timestamp: 1_792_000_000_000, duration: 30, phoneAccountId: "work", ...over });
  it("only the chosen work SIM is ever uploaded", () => {
    expect(fromAndroid(e({ phoneAccountId: "personal" }), "work")).toBeNull();
    expect(fromAndroid(e(), null)).toBeNull(); // nothing is uploaded until a work SIM is chosen
    expect(fromAndroid(e(), "work")).not.toBeNull();
  });
  it("maps the call kinds", () => {
    expect(fromAndroid(e({ rawType: 1 }), "work")).toMatchObject({ direction: "inbound", status: "connected" });
    expect(fromAndroid(e({ rawType: 1, duration: 0 }), "work")).toMatchObject({ direction: "inbound", status: "missed" });
    expect(fromAndroid(e({ rawType: 2, duration: 0 }), "work")).toMatchObject({ direction: "outbound", status: "failed" });
    expect(fromAndroid(e({ rawType: 3 }), "work")).toMatchObject({ direction: "inbound", status: "missed" });
    expect(fromAndroid(e({ rawType: 5 }), "work")).toMatchObject({ status: "rejected" });
    expect(fromAndroid(e({ rawType: 4 }), "work")).toBeNull(); // voicemail
    expect(fromAndroid(e({ phoneNumber: "" }), "work")).toBeNull();
    expect(fromAndroid(e({ timestamp: "nope" }), "work")).toBeNull();
  });
  it("gives the same id every time the same call is read, and keeps numbers as they are", () => {
    expect(fromAndroid(e(), "work")!.localId).toBe(fromAndroid(e(), "work")!.localId);
    expect(fromAndroid(e(), "work")!.localId).not.toBe(fromAndroid(e({ timestamp: 1_792_000_000_001 }), "work")!.localId);
    expect(fromAndroid(e({ duration: "30" }), "work")!.durationS).toBe(30);
  });
  it("reads from just after the last handled call, but never more than a week back", () => {
    const now = 1_792_000_000_000;
    expect(readFrom(null, now)).toBe(now - 7 * 86_400_000);
    expect(readFrom(now - 1000, now)).toBe(now - 999);
    expect(readFrom(now - 30 * 86_400_000, now)).toBe(now - 7 * 86_400_000);
    expect(newestTimestamp([e({ timestamp: 5 }), e({ timestamp: "9" }), e({ timestamp: 7 })])).toBe(9);
  });
});

describe("offline queue", () => {
  it("keeps calls until the server answers, and removes them after", async () => {
    const q = new SyncQueue(memory());
    await q.add([call(1), call(2)]);
    const seen: string[][] = [];
    const r = await q.flush(fakeApi(async (cs) => { seen.push(cs.map((c) => c.localId)); return saved(cs); }));
    expect(r).toEqual({ sent: 2, kept: 0, state: "done" });
    expect(seen).toEqual([["c1", "c2"]]);
    expect(await q.pending()).toEqual([]);
  });
  it("loses nothing when the network is down, and backs off", async () => {
    const q = new SyncQueue(memory());
    await q.add([call(1)]);
    const down = fakeApi(async () => { throw new NetworkError("offline"); });
    expect(await q.flush(down)).toMatchObject({ state: "offline", kept: 1, nextTryInS: 5 });
    expect(await q.flush(down)).toMatchObject({ nextTryInS: 10 });
    expect(await q.pending()).toHaveLength(1);
    expect(await q.flush(fakeApi(async (cs) => saved(cs)))).toMatchObject({ state: "done", sent: 1 });
    expect(await q.flush(down)).toMatchObject({ state: "done" }); // nothing left to send, so no failure counted
  });
  it("survives the app being closed: a new queue on the same storage still has the calls", async () => {
    const store = memory();
    await new SyncQueue(store).add([call(1), call(2)]);
    expect(await new SyncQueue(store).pending()).toHaveLength(2);
  });
  it("does not add the same call twice", async () => {
    const q = new SyncQueue(memory());
    await q.add([call(1), call(1)]); await q.add([call(1), call(2)]);
    expect((await q.pending()).map((c) => c.localId)).toEqual(["c1", "c2"]);
  });
  it("stops and keeps everything when the phone has been unlinked", async () => {
    const q = new SyncQueue(memory());
    await q.add([call(1)]);
    expect(await q.flush(fakeApi(async () => { throw new UnpairedError(); }))).toMatchObject({ state: "unpaired", kept: 1 });
    expect(await q.pending()).toHaveLength(1);
  });
  it("treats calls the server refused as finished, so one bad call never blocks the rest", async () => {
    const q = new SyncQueue(memory());
    await q.add([call(1), call(2)]);
    const r = await q.flush(fakeApi(async (cs) => cs.map((c, i): SyncOutcome => (i === 0 ? { localId: c.localId, result: "rejected", reason: "invalid_number" } : { localId: c.localId, result: "saved" }))));
    expect(r).toMatchObject({ state: "done", sent: 1 });
    expect(await q.pending()).toEqual([]);
  });
  it("sends large backlogs in batches, and a repeat answered 'duplicate' also clears the call", async () => {
    const q = new SyncQueue(memory());
    await q.add(Array.from({ length: BATCH * 2 + 5 }, (_, i) => call(i)));
    const sizes: number[] = [];
    await q.flush(fakeApi(async (cs) => { sizes.push(cs.length); return cs.map((c) => ({ localId: c.localId, result: "duplicate" as const })); }));
    expect(sizes).toEqual([BATCH, BATCH, 5]);
    expect(await q.pending()).toEqual([]);
  });
  it("two flushes at once send once", async () => {
    const q = new SyncQueue(memory());
    await q.add([call(1)]);
    let n = 0;
    const api = fakeApi(async (cs) => { n++; await new Promise((r) => setTimeout(r, 10)); return saved(cs); });
    await Promise.all([q.flush(api), q.flush(api)]);
    expect(n).toBe(1);
  });
  it("does not spin when the server answers 200 but about nothing", async () => {
    const q = new SyncQueue(memory());
    await q.add([call(1)]);
    expect(await q.flush(fakeApi(async () => []))).toMatchObject({ state: "offline", kept: 1 });
  });
  it("drops the oldest when a very long outage fills the queue", async () => {
    const q = new SyncQueue(memory());
    await q.add(Array.from({ length: MAX_QUEUE + 3 }, (_, i) => call(i)));
    const p = await q.pending();
    expect(p).toHaveLength(MAX_QUEUE);
    expect(p[0]!.localId).toBe("c3");
  });
  it("backoff grows and stops at 15 minutes", () => {
    expect([1, 2, 3, 4].map(backoffSeconds)).toEqual([5, 10, 20, 40]);
    expect(backoffSeconds(30)).toBe(900);
  });
});

describe("api client", () => {
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it("sends the token as a bearer header and not in the address", async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const api = createApi({ baseUrl: "https://x.test/", token: "vd_abc", fetch: (async (url: string, init: RequestInit) => { seen = { url, headers: init.headers as Record<string, string> }; return new Response("{\"leads\":[]}"); }) as unknown as typeof fetch });
    await api.leads();
    expect(seen!.url).toBe("https://x.test/api/mobile/leads");
    expect(seen!.headers.authorization).toBe("Bearer vd_abc");
  });
  it("401 means unlinked, 5xx and no network mean try later, 4xx means the request was refused", async () => {
    await expect(createApi({ baseUrl: "https://x.test", token: "t", fetch: reply(401, {}) }).me()).rejects.toBeInstanceOf(UnpairedError);
    await expect(createApi({ baseUrl: "https://x.test", token: "t", fetch: reply(503, {}) }).me()).rejects.toBeInstanceOf(NetworkError);
    await expect(createApi({ baseUrl: "https://x.test", token: "t", fetch: (async () => { throw new TypeError("Network request failed"); }) as unknown as typeof fetch }).me()).rejects.toBeInstanceOf(NetworkError);
    const bad = await createApi({ baseUrl: "https://x.test", fetch: reply(400, { error: "invalid_code" }) }).register({ code: "x", fingerprint: "y", platform: "ios" }).catch((e) => e);
    expect(bad).toBeInstanceOf(RequestError);
    expect(bad.code).toBe("invalid_code");
    const limited = await createApi({ baseUrl: "https://x.test", fetch: reply(429, { error: "too_many_attempts" }) }).register({ code: "x", fingerprint: "y", platform: "ios" }).catch((e) => e);
    expect(limited).toBeInstanceOf(RequestError); // while pairing there is no token, so a rate limit is shown to the person, not retried silently
  });
});
