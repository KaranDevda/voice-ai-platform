import { describe, expect, it, vi } from "vitest";
import { createAskG1 } from "./askg1";
import { createDeepgramStt, createDeepgramTts, parseDeepgramTranscript, splitForSpeech } from "./deepgram";
import { createElevenLabsTts } from "./elevenlabs";
import { ProviderError } from "./types";
import { STOCK_VOICES, stockVoiceById } from "./voices";

const sse = (...lines: string[]) =>
  new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(lines.join("\n") + "\n")); c.close(); } }), { status: 200 });

describe("deepgram transcription", () => {
  it("prefers utterances and converts seconds to ms", () => {
    const t = parseDeepgramTranscript({
      metadata: { duration: 5 },
      results: { channels: [{ detected_language: "en", alternatives: [{ transcript: "hi there fine" }] }], utterances: [{ start: 0.5, end: 1.25, transcript: " hi there ", speaker: 1 }, { start: 2, end: 3, transcript: "fine", speaker: 0 }] },
    });
    expect(t.segments).toEqual([{ speaker: 1, startMs: 500, endMs: 1250, text: "hi there" }, { speaker: 0, startMs: 2000, endMs: 3000, text: "fine" }]);
    expect(t.language).toBe("en");
    expect(t.durationS).toBe(5);
  });

  it("falls back to grouping words by speaker, then to the plain transcript", () => {
    const words = parseDeepgramTranscript({ results: { channels: [{ alternatives: [{ transcript: "a b c", words: [
      { word: "a", start: 0, end: 1, speaker: 0 }, { word: "b", start: 1, end: 2, speaker: 0 }, { word: "c", start: 2, end: 3, speaker: 1 }] }] }] } });
    expect(words.segments.map((s) => [s.speaker, s.text])).toEqual([[0, "a b"], [1, "c"]]);
    expect(parseDeepgramTranscript({ metadata: { duration: 2 }, results: { channels: [{ alternatives: [{ transcript: "just text" }] }] } }).segments).toHaveLength(1);
    expect(parseDeepgramTranscript({}).segments).toEqual([]);
  });

  it("sends raw audio with the right model, auth and language flags", async () => {
    const f = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: "x" }] }] } }), { status: 200 }));
    await createDeepgramStt({ apiKey: "k", fetch: f }).transcribe({ audio: new Uint8Array([1]), mime: "audio/mpeg", language: "auto", diarize: false });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toContain("model=nova-3");
    expect(url).toContain("detect_language=true");
    expect(url).toContain("diarize=false");
    expect(init.headers.authorization).toBe("Token k");
    expect(init.headers["content-type"]).toBe("audio/mpeg");
    await createDeepgramStt({ apiKey: "k", fetch: f }).transcribe({ audio: new Uint8Array([1]), mime: "audio/wav", language: "hi" });
    expect(f.mock.calls[1]![0]).toContain("language=hi");
  });

  it("raises a ProviderError with the status on failure", async () => {
    const stt = createDeepgramStt({ apiKey: "k", fetch: vi.fn().mockResolvedValue(new Response("bad key", { status: 401 })) });
    await expect(stt.transcribe({ audio: new Uint8Array(), mime: "audio/wav" })).rejects.toMatchObject({ status: 401, provider: "deepgram" });
  });
});

describe("deepgram speech", () => {
  it("splits long text under the 2,000-character limit without losing words", () => {
    const text = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const parts = splitForSpeech(text, 2000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 2000)).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(text);
    expect(splitForSpeech("short", 2000)).toEqual(["short"]);
  });

  it("requests µ-law 8 kHz raw audio for calls and concatenates pieces", async () => {
    const f = vi.fn().mockImplementation(async () => new Response(new Uint8Array([7, 7]), { status: 200 }));
    const r = await createDeepgramTts({ apiKey: "k", fetch: f }).speak({ text: "x".repeat(2500), voiceId: "aura-2-thalia-en", format: "mulaw8k" });
    expect(f.mock.calls.length).toBe(2);
    expect(f.mock.calls[0]![0]).toContain("encoding=mulaw");
    expect(f.mock.calls[0]![0]).toContain("sample_rate=8000");
    expect(f.mock.calls[0]![0]).toContain("container=none");
    expect(r.audio.length).toBe(4);
  });

  it("has a unique, well-formed stock voice catalogue", () => {
    expect(new Set(STOCK_VOICES.map((v) => v.id)).size).toBe(STOCK_VOICES.length);
    expect(STOCK_VOICES.every((v) => /^aura-2-[a-z]+-en$/.test(v.id))).toBe(true);
    expect(stockVoiceById("aura-2-thalia-en")?.gender).toBe("female");
  });
});

describe("elevenlabs extras", () => {
  it("clones from samples as multipart and returns the voice id", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ voice_id: "v123" }), { status: 200 }));
    const out = await createElevenLabsTts({ apiKey: "k", fetch: f }).cloneVoice({ label: "Priya", samples: [{ name: "a.webm", mime: "audio/webm", data: new Uint8Array([1, 2]) }] });
    expect(out.providerVoiceId).toBe("v123");
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.elevenlabs.io/v1/voices/add");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("name")).toBe("Priya");
    expect(init.headers["xi-api-key"]).toBe("k");
  });

  it("fails clearly when no voice id comes back or the call errors", async () => {
    const noId = createElevenLabsTts({ apiKey: "k", fetch: vi.fn().mockResolvedValue(new Response("{}", { status: 200 })) });
    await expect(noId.cloneVoice({ label: "x", samples: [] })).rejects.toBeInstanceOf(ProviderError);
    const bad = createElevenLabsTts({ apiKey: "k", fetch: vi.fn().mockResolvedValue(new Response("quota", { status: 402 })) });
    await expect(bad.cloneVoice({ label: "x", samples: [] })).rejects.toMatchObject({ status: 402 });
  });

  it("speaks a whole clip as mp3", async () => {
    const f = vi.fn().mockResolvedValue(new Response(new Uint8Array([9]), { status: 200 }));
    const r = await createElevenLabsTts({ apiKey: "k", fetch: f }).speak({ text: "hi", voiceId: "v" });
    expect(f.mock.calls[0]![0]).toContain("output_format=mp3_44100_128");
    expect(r.mime).toBe("audio/mpeg");
  });
});

describe("askg1", () => {
  it("streams tokens from OpenAI-style SSE and stops at [DONE]", async () => {
    const f = vi.fn().mockResolvedValue(sse('data: {"choices":[{"delta":{"content":"Hel"}}]}', "", ": keep-alive", 'data: {"choices":[{"delta":{"content":"lo"}}]}', "data: [DONE]", 'data: {"choices":[{"delta":{"content":"ignored"}}]}'));
    const llm = createAskG1({ baseUrl: "http://vpn:8080/", apiKey: "k", fetch: f });
    let out = "";
    for await (const t of llm.chat({ messages: [{ role: "user", content: "hi" }] })) out += t;
    expect(out).toBe("Hello");
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("http://vpn:8080/v1/chat/completions");
    expect(JSON.parse(init.body)).toMatchObject({ model: "g1-chat", stream: true });
    expect(init.headers.authorization).toBe("Bearer k");
  });

  it("reports an unreachable or failing service as a ProviderError", async () => {
    const llm = createAskG1({ baseUrl: "http://x", apiKey: "k", fetch: vi.fn().mockResolvedValue(new Response("no", { status: 503 })) });
    await expect(llm.chat({ messages: [] })[Symbol.asyncIterator]().next()).rejects.toMatchObject({ status: 503, provider: "askg1" });
  });

  it("gives up with a clear error when AskG1 never answers", async () => {
    const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    const llm = createAskG1({ baseUrl: "http://x", apiKey: "k", responseTimeoutMs: 30, fetch: hang as unknown as typeof fetch });
    await expect(llm.chat({ messages: [] })[Symbol.asyncIterator]().next()).rejects.toMatchObject({ status: 504, provider: "askg1" });
  });

  it("stops promptly when the caller aborts", async () => {
    const hang = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    const ctl = new AbortController();
    const llm = createAskG1({ baseUrl: "http://x", apiKey: "k", responseTimeoutMs: 60_000, fetch: hang as unknown as typeof fetch });
    const next = llm.chat({ messages: [], signal: ctl.signal })[Symbol.asyncIterator]().next();
    ctl.abort();
    await expect(next).rejects.toMatchObject({ name: "AbortError" });
  });

  it("builds a grounded system prompt for live replies", async () => {
    const f = vi.fn().mockResolvedValue(sse("data: [DONE]"));
    const llm = createAskG1({ baseUrl: "http://x", apiKey: "k", fetch: f });
    for await (const _ of llm.respond({ transcript: "price?", leadContext: { name: "Asha" }, knowledge: ["Plan A costs 10"] })) void _;
    const msgs = JSON.parse(f.mock.calls[0]![1].body).messages;
    expect(msgs[0].content).toContain("Plan A costs 10");
    expect(msgs[0].content).toContain("Asha");
    expect(msgs[1]).toEqual({ role: "user", content: "price?" });
  });
});
