import { describe, expect, it, vi } from "vitest";
import { createElevenLabsTts, ElevenLabsError } from "./elevenlabs";

const streamOf = (...chunks: number[][]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      chunks.forEach((ch) => c.enqueue(new Uint8Array(ch)));
      c.close();
    },
  });

describe("elevenlabs tts", () => {
  it("requests 8 kHz µ-law and yields chunks as they arrive", async () => {
    const f = vi.fn().mockResolvedValue(new Response(streamOf([1, 2], [3]), { status: 200 }));
    const tts = createElevenLabsTts({ apiKey: "k", fetch: f });
    const out: number[][] = [];
    for await (const frame of tts.synthesize({ text: "hello", providerVoiceId: "v/1" })) out.push([...frame]);

    expect(out).toEqual([[1, 2], [3]]);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/v%2F1/stream?output_format=ulaw_8000");
    expect(init.headers["xi-api-key"]).toBe("k");
    expect(JSON.parse(init.body)).toMatchObject({ text: "hello" });
  });

  it("throws on upstream errors", async () => {
    const tts = createElevenLabsTts({ apiKey: "k", fetch: vi.fn().mockResolvedValue(new Response("no", { status: 401 })) });
    await expect(tts.synthesize({ text: "x", providerVoiceId: "v" })[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(ElevenLabsError);
  });

  it("delete is idempotent on 404 but fails on other errors", async () => {
    const ok = createElevenLabsTts({ apiKey: "k", fetch: vi.fn().mockResolvedValue(new Response("", { status: 404 })) });
    await expect(ok.deleteVoice("v")).resolves.toBeUndefined();
    const bad = createElevenLabsTts({ apiKey: "k", fetch: vi.fn().mockResolvedValue(new Response("", { status: 500 })) });
    await expect(bad.deleteVoice("v")).rejects.toThrow(/500/);
  });
});
