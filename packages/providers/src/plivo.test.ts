import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPlivo, parsePlivoStreamMessage, plivoClearAudio, plivoDialXml, plivoPlayAudio, plivoSignatureV3, plivoStreamXml, verifyPlivoSignature } from "./plivo";

const TOKEN = "test-auth-token-0123456789";
const sign = (text: string) => createHmac("sha256", TOKEN).update(text).digest("base64");

describe("Plivo webhook signatures (V3)", () => {
  it("signs a POST as URL + the parameters sorted, name then value, then '.' and the nonce", () => {
    const sig = plivoSignatureV3({ url: "https://voice.example.com/plivo/answer", params: { To: "+911", CallUUID: "abc", From: "+912" }, nonce: "n1", authToken: TOKEN });
    expect(sig).toBe(sign("https://voice.example.com/plivo/answer" + "CallUUIDabc" + "From+912" + "To+911" + ".n1"));
  });
  it("signs a GET with the query sorted into the URL", () => {
    const sig = plivoSignatureV3({ method: "GET", url: "https://h.example.com/a", params: { b: "2", a: "1" }, nonce: "n", authToken: TOKEN });
    expect(sig).toBe(sign("https://h.example.com/a?a=1&b=2.n"));
  });
  it("keeps a query string that is already in the URL and adds a dot before the POST parameters", () => {
    const sig = plivoSignatureV3({ url: "https://h.example.com/a?t=xyz&k=1", params: { X: "y" }, nonce: "n", authToken: TOKEN });
    expect(sig).toBe(sign("https://h.example.com/a?k=1&t=xyz." + "Xy" + ".n"));
  });
  it("includes a non-default port and leaves the default one out", () => {
    expect(plivoSignatureV3({ url: "https://h.example.com:8443/a", nonce: "n", authToken: TOKEN })).toBe(sign("https://h.example.com:8443/a.n"));
    expect(plivoSignatureV3({ url: "https://h.example.com:443/a", nonce: "n", authToken: TOKEN })).toBe(sign("https://h.example.com/a.n"));
  });
  it("accepts the right signature, including one of several separated by commas, and refuses everything else", () => {
    const args = { url: "https://h.example.com/plivo/answer", params: { CallUUID: "abc" }, nonce: "n9", authToken: TOKEN };
    const good = plivoSignatureV3(args);
    expect(verifyPlivoSignature({ ...args, header: good })).toBe(true);
    expect(verifyPlivoSignature({ ...args, header: `wrong, ${good}` })).toBe(true);
    expect(verifyPlivoSignature({ ...args, header: "wrong" })).toBe(false);
    expect(verifyPlivoSignature({ ...args, header: undefined })).toBe(false);
    expect(verifyPlivoSignature({ ...args, nonce: undefined, header: good })).toBe(false);
    expect(verifyPlivoSignature({ ...args, params: { CallUUID: "tampered" }, header: good })).toBe(false);
    expect(verifyPlivoSignature({ ...args, authToken: "another-token", header: good })).toBe(false);
    expect(verifyPlivoSignature({ ...args, url: "https://evil.example.com/plivo/answer", header: good })).toBe(false);
  });
});

describe("Plivo call XML", () => {
  it("opens a two-way 8 kHz µ-law stream and escapes the address", () => {
    const xml = plivoStreamXml("wss://h.example.com/plivo/stream?token=a&language=hi");
    expect(xml).toContain('bidirectional="true"');
    expect(xml).toContain('keepCallAlive="true"');
    expect(xml).toContain('contentType="audio/x-mulaw;rate=8000"');
    expect(xml).toContain("token=a&amp;language=hi</Stream>");
  });
  it("dials a number, and cannot be tricked by markup in it", () => {
    expect(plivoDialXml("+919800000001")).toContain("<Number>+919800000001</Number>");
    expect(plivoDialXml("+91</Number><Hangup/>")).not.toContain("<Hangup/>");
  });
});

describe("Plivo audio stream messages", () => {
  it("reads start, media and stop", () => {
    expect(parsePlivoStreamMessage(JSON.stringify({ event: "start", start: { callId: "c1", streamId: "s1" } }))).toEqual({ type: "start", callId: "c1", streamId: "s1" });
    const m = parsePlivoStreamMessage(JSON.stringify({ event: "media", media: { track: "inbound", payload: Buffer.from([1, 2, 255]).toString("base64") } }));
    expect(m).toEqual({ type: "media", audio: new Uint8Array([1, 2, 255]) });
    expect(parsePlivoStreamMessage('{"event":"stop"}')).toEqual({ type: "stop" });
    expect(parsePlivoStreamMessage('{"event":"clearedAudio"}')).toEqual({ type: "other", event: "clearedAudio" });
  });
  it("ignores anything malformed", () => {
    for (const bad of ["", "not json", "[]", '{"x":1}', '{"event":"media"}', '{"event":"media","media":{"payload":5}}']) expect(parsePlivoStreamMessage(bad)).toBeNull();
  });
  it("builds playAudio and clearAudio the way Plivo expects", () => {
    expect(JSON.parse(plivoPlayAudio(new Uint8Array([0, 255])))).toEqual({ event: "playAudio", media: { contentType: "audio/x-mulaw", sampleRate: 8000, payload: "AP8=" } });
    expect(JSON.parse(plivoClearAudio("s1"))).toEqual({ event: "clearAudio", streamId: "s1" });
  });
});

describe("Plivo REST calls", () => {
  const recorder = (reply: { status?: number; body?: unknown } = {}) => {
    const seen: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];
    const fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, method: init.method!, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200 });
    }) as unknown as typeof globalThis.fetch;
    return { seen, plivo: createPlivo({ authId: "MAXXXX", authToken: "tok", fetch }) };
  };
  it("places a call with the account's basic login", async () => {
    const { seen, plivo } = recorder({ body: { request_uuid: ["req-1"] } });
    expect(await plivo.makeCall({ from: "+9180", to: "+9198", answerUrl: "https://h/a" })).toEqual({ callUuid: "req-1" });
    expect(seen[0]!.url).toBe("https://api.plivo.com/v1/Account/MAXXXX/Call/");
    expect(seen[0]!.headers.authorization).toBe(`Basic ${Buffer.from("MAXXXX:tok").toString("base64")}`);
    expect(seen[0]!.body).toEqual({ from: "+9180", to: "+9198", answer_url: "https://h/a", answer_method: "POST" });
  });
  it("transfers the caller's side of a live call to new instructions", async () => {
    const { seen, plivo } = recorder();
    await plivo.transferCall({ callUuid: "uuid/1", legUrl: "https://h/transfer" });
    expect(seen[0]).toMatchObject({ method: "POST", url: "https://api.plivo.com/v1/Account/MAXXXX/Call/uuid%2F1/", body: { legs: "aleg", aleg_url: "https://h/transfer", aleg_method: "POST" } });
  });
  it("hangs up", async () => {
    const { seen, plivo } = recorder();
    await plivo.hangup("u1");
    expect(seen[0]).toMatchObject({ method: "DELETE", url: "https://api.plivo.com/v1/Account/MAXXXX/Call/u1/" });
  });
  it("turns a refusal into a readable error", async () => {
    const { plivo } = recorder({ status: 401, body: { error: "Authentication credentials invalid" } });
    await expect(plivo.makeCall({ from: "a", to: "b", answerUrl: "https://h/a" })).rejects.toThrow(/Plivo POST \/Call\/ failed \(401\): Authentication credentials invalid/);
  });
});
