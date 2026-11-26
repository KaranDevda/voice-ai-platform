import { describe, expect, it } from "vitest";
import { createMaya2, maya2Text } from "./maya2";

const recording = new Uint8Array([1, 2, 3, 4]);

function fakeServer(voices: string[] = []) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const fetchMock = (async (url: string, init: RequestInit = {}) => {
    const path = new URL(url).pathname;
    calls.push({ url: path, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body as string) : undefined });
    if (path === "/v1/voices" && !init.method) return Response.json({ voices: voices.map((id) => ({ id })) });
    if (path === "/v1/voices") return Response.json({ id: "x" }, { status: 201 });
    if (path === "/v1/audio/speech") return new Response(new Uint8Array([0, 1, 2, 3, 4]), { status: 200 }); // odd length on purpose
    return new Response("no", { status: 404 });
  }) as unknown as typeof fetch;
  return { calls, fetchMock };
}

describe("maya2", () => {
  it("picks Hindi when the text has Devanagari and English otherwise", () => {
    expect(maya2Text("नमस्ते, call back").language).toBe("hi");
    expect(maya2Text("Hello, how are you?").language).toBe("en");
  });

  it("registers the saved recording once, then speaks with that voice", async () => {
    const { calls, fetchMock } = fakeServer();
    const maya = createMaya2({ baseUrl: "http://gpu:8080/", token: "t", fetch: fetchMock, loadRecording: async () => recording });
    await maya.wav("Hello there", "abc-123");
    await maya.wav("Hello again", "abc-123");
    expect(calls.filter((c) => c.method === "POST" && c.url === "/v1/voices")).toHaveLength(1);
    const speech = calls.filter((c) => c.url === "/v1/audio/speech");
    expect(speech).toHaveLength(2);
    expect((speech[0]!.body as { voice: string; response_format: string }).voice).toBe("c_abc-123");
    expect((speech[0]!.body as { response_format: string }).response_format).toBe("wav");
  });

  it("does not upload again when the server already has the voice", async () => {
    const { calls, fetchMock } = fakeServer(["c_abc-123"]);
    const maya = createMaya2({ baseUrl: "http://gpu:8080", fetch: fetchMock, loadRecording: async () => recording });
    await maya.wav("Hi", "abc-123");
    expect(calls.some((c) => c.method === "POST" && c.url === "/v1/voices")).toBe(false);
  });

  it("says so plainly when a voice has no recording", async () => {
    const { fetchMock } = fakeServer();
    const maya = createMaya2({ baseUrl: "http://gpu:8080", fetch: fetchMock, loadRecording: async () => null });
    await expect(maya.wav("Hi", "nobody")).rejects.toThrow(/no saved recording/);
  });

  it("streams only whole 16-bit samples", async () => {
    const { fetchMock } = fakeServer(["c_abc"]);
    const maya = createMaya2({ baseUrl: "http://gpu:8080", fetch: fetchMock });
    const parts: Uint8Array[] = [];
    for await (const c of maya.pcm("Hi", "abc")) parts.push(c);
    expect(parts.every((p) => p.length % 2 === 0)).toBe(true);
  });
});

import { trimWav } from "./maya2";
import { describe as d2, it as i2, expect as e2 } from "vitest";
d2("trimWav", () => {
  const make = (seconds: number) => {
    const rate = 16000, n = seconds * rate * 2, b = new Uint8Array(44 + n), dv = new DataView(b.buffer);
    b.set([82, 73, 70, 70], 0); dv.setUint32(4, 36 + n, true); b.set([87, 65, 86, 69, 102, 109, 116, 32], 8);
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, rate, true);
    dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); b.set([100, 97, 116, 97], 36); dv.setUint32(40, n, true);
    return b;
  };
  i2("cuts a 52 s recording to 10 s with a valid header", () => {
    const out = trimWav(make(52));
    e2(out.byteLength).toBe(44 + 10 * 16000 * 2);
    e2(new DataView(out.buffer).getUint32(40, true)).toBe(10 * 16000 * 2);
  });
  i2("leaves a short recording alone", () => { const w = make(5); e2(trimWav(w)).toBe(w); });
});
