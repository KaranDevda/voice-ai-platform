import { describe, expect, it } from "vitest";
import type { ChatMessage, LlmAdapter, SttAdapter, SttEvent } from "@voiceai/providers";
import { Conversation, type ServerEvent, type TtsEngine } from "./pipeline";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Speech recogniser whose events the test fires by hand. */
function fakeStt() {
  const q: SttEvent[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const adapter: SttAdapter = {
    async open() {
      return {
        send() {},
        async close() { closed = true; wake?.(); },
        events: { async *[Symbol.asyncIterator]() { for (;;) { while (q.length) yield q.shift()!; if (closed) return; await new Promise<void>((r) => (wake = r)); } } },
      };
    },
  };
  return { adapter, fire: (e: SttEvent) => { q.push(e); wake?.(); } };
}

/** Model that streams `reply` in small tokens, optionally failing or recording the prompts it received. */
function fakeLlm(reply: string, opts: { delayMs?: number; fail?: boolean; seen?: ChatMessage[][] } = {}): LlmAdapter {
  return {
    respond: () => (async function* () {})(),
    async *chat({ messages, signal }) {
      opts.seen?.push(messages);
      if (opts.fail) throw new Error("AskG1 is down");
      for (let i = 0; i < reply.length; i += 4) {
        if (opts.delayMs) await sleep(opts.delayMs);
        if (signal?.aborted) return;
        yield reply.slice(i, i + 4);
      }
    },
  };
}

/** Voice that takes `perChunkMs` per audio chunk and labels each chunk with its sentence. */
function fakeTts(perChunkMs = 0, chunks = 3): TtsEngine {
  return {
    encoding: "linear16", rate: 24_000,
    async *speak(text, signal) {
      for (let i = 0; i < chunks; i++) {
        if (perChunkMs) await sleep(perChunkMs);
        if (signal.aborted) return;
        yield new TextEncoder().encode(`${text}#${i}`);
      }
    },
  };
}

function setup(over: { language?: "en" | "hi" | "en-hi"; ground?: (t: string, previous?: string) => Promise<string[]>; llm?: LlmAdapter; tts?: TtsEngine; greeting?: string; fallback?: string; chunkMs?: number; handoff?: ConstructorParameters<typeof Conversation>[0]["handoff"] } = {}) {
  const stt = fakeStt();
  const events: ServerEvent[] = [];
  const audio: string[] = [];
  const convo = new Conversation({
    stt: stt.adapter, llm: over.llm ?? fakeLlm("Hello there. How are you today?"), tts: over.tts ?? fakeTts(), language: over.language ?? "en-hi", systemPrompt: "be brief",
    greeting: over.greeting, fallback: over.fallback, ground: over.ground, handoff: over.handoff, chunkDurationMs: over.chunkMs === undefined ? undefined : () => over.chunkMs!,
    send: (e) => events.push(e), sendAudio: (c) => audio.push(new TextDecoder().decode(c)),
  });
  return { convo, stt, events, audio };
}
const types = (events: ServerEvent[]) => events.map((e) => e.type);
const until = async (cond: () => boolean, ms = 2000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error("timed out"); await sleep(5); } };

describe("Conversation: replies cut off by the length limit", () => {
  it("does not speak half a sentence left over when the model ran out of room", async () => {
    const { convo, stt, events } = setup({ llm: fakeLlm("First sentence is complete. And the second one was cut off in the mid") });
    await convo.start();
    stt.fire({ kind: "final", text: "tell me" });
    await until(() => events.some((e) => e.type === "timing"));
    await sleep(40);
    expect(events.filter((e) => e.type === "assistant").map((e) => (e as { text: string }).text)).toEqual(["First sentence is complete."]);
    await convo.close();
  });
  it("still speaks a short answer that has no ending punctuation", async () => {
    const { convo, stt, events } = setup({ llm: fakeLlm("Sure thing") });
    await convo.start();
    stt.fire({ kind: "final", text: "hi" });
    await until(() => events.some((e) => e.type === "assistant"));
    expect((events.find((e) => e.type === "assistant") as { text: string }).text).toBe("Sure thing");
    await convo.close();
  });
});

describe("Conversation grounding", () => {
  it("gives the model the company knowledge found for what the caller said", async () => {
    const seen: ChatMessage[][] = []; const asked: string[] = [];
    const { convo, stt, events } = setup({ llm: fakeLlm("Okay.", { seen }), ground: async (t) => { asked.push(t); return ["Pricing: The Business plan costs 4,999 rupees per month."]; } });
    await convo.start();
    stt.fire({ kind: "final", text: "how much is the business plan" });
    await until(() => events.some((e) => e.type === "timing"));
    expect(asked).toEqual(["how much is the business plan"]);
    const turn = seen[0]!.at(-1)!.content;
    expect(turn).toContain("how much is the business plan");
    expect(turn).toContain("[1] Pricing: The Business plan costs 4,999 rupees per month.");
    expect(seen[0]![0]!.content).toBe("be brief"); // the system prompt itself never changes between turns
    await convo.close();
  });

  it("answers a repeated question from the saved answer, without asking the model again", async () => {
    const seen: ChatMessage[][] = [];
    const tts = { ...fakeTts(), cacheKey: "test-voice-cache" } as TtsEngine;
    const ground = async () => ["Pricing: The Business plan costs 4,999 rupees per month."];
    const ask = async () => {
      const { convo, stt, events, audio } = setup({ llm: fakeLlm("The Business plan costs 4,999 rupees per month.", { seen }), ground, tts, language: "en" });
      await convo.start();
      stt.fire({ kind: "final", text: "what does the saved business plan cost" });
      await until(() => events.some((e) => e.type === "timing"));
      const said = events.filter((e) => e.type === "assistant").map((e) => (e as { text: string }).text).join(" ");
      await convo.close();
      return { said, audio: audio.length };
    };
    const first = await ask();
    const second = await ask();
    expect(seen).toHaveLength(1); // the model was asked once
    expect(second.said).toBe(first.said);
    expect(second.audio).toBeGreaterThan(0);
  });

  it("tells the model not to guess when nothing in the knowledge base matched", async () => {
    const seen: ChatMessage[][] = [];
    const { convo, stt, events } = setup({ llm: fakeLlm("I do not have that.", { seen }), ground: async () => [] });
    await convo.start();
    stt.fire({ kind: "final", text: "what does the premium plan cost" });
    await until(() => events.some((e) => e.type === "timing"));
    expect(seen[0]!.at(-1)!.content).toMatch(/company knowledge: none/);
    await convo.close();
  });

  it("repeats earlier turns word for word, so the model's saved copy of the conversation keeps matching", async () => {
    const seen: ChatMessage[][] = [];
    const { convo, stt, events } = setup({ llm: fakeLlm("Sure.", { seen }), ground: async () => [] });
    await convo.start();
    stt.fire({ kind: "final", text: "what plans do you have" });
    await until(() => events.filter((e) => e.type === "timing").length === 1);
    stt.fire({ kind: "final", text: "and the price" });
    await until(() => events.filter((e) => e.type === "timing").length === 2);
    expect(seen[0]![1]!.content).toMatch(/\[note: company knowledge: none\]/);
    expect(seen[1]![1]!.content).toBe(seen[0]![1]!.content);
    expect(seen[1]!.at(-1)!.content).toMatch(/^and the price/);
    await convo.close();
  });

  it("searches again with the caller's earlier question when a follow-up gives the knowledge search nothing to go on", async () => {
    const asked: Array<[string, string | undefined]> = [];
    const { convo, stt, events } = setup({ llm: fakeLlm("Okay."), ground: async (t, prev) => { asked.push([t, prev]); return []; } });
    await convo.start();
    stt.fire({ kind: "final", text: "tell me about your plans" });
    await until(() => events.filter((e) => e.type === "timing").length === 1);
    await sleep(30);
    stt.fire({ kind: "final", text: "and the other ones" });
    await until(() => asked.length === 2);
    expect(asked[0]).toEqual(["tell me about your plans", undefined]);
    expect(asked[1]).toEqual(["and the other ones", "tell me about your plans"]);
    await convo.close();
  });

  it("still answers if the knowledge lookup fails", async () => {
    const { convo, stt, events, audio } = setup({ ground: async () => { throw new Error("database down"); } });
    await convo.start();
    stt.fire({ kind: "final", text: "hello" });
    await until(() => audio.length > 0);
    expect(events.some((e) => e.type === "error")).toBe(false);
    await convo.close();
  });

  it("keeps the system prompt and the earlier turns identical from turn to turn, so the model can reuse what it already read", async () => {
    const seen: ChatMessage[][] = [];
    const { convo, stt, events } = setup({ llm: fakeLlm("Okay.", { seen }), ground: async (t) => [`Pricing: about ${t}`] });
    await convo.start();
    stt.fire({ kind: "final", text: "first question" });
    await until(() => events.filter((e) => e.type === "timing").length === 1);
    await sleep(30);
    stt.fire({ kind: "final", text: "second question" });
    await until(() => seen.length === 2);
    expect(seen[1]![0]).toEqual(seen[0]![0]);                         // same system prompt
    expect(seen[1]![1]!.content).toBe(seen[0]!.at(-1)!.content);      // the earlier user turn goes out exactly as it did the first time (note included)
    expect(seen[1]![1]!.content).toContain("Pricing: about first question");
    expect(seen[1]!.at(-1)!.content).toContain("second question");
    expect(seen[1]!.at(-1)!.content).toContain("Pricing: about second question");
    await convo.close();
  });

  it("does not add any knowledge text when no lookup is configured", async () => {
    const seen: ChatMessage[][] = [];
    const { convo, stt, events } = setup({ llm: fakeLlm("Okay.", { seen }) });
    await convo.start();
    stt.fire({ kind: "final", text: "hi" });
    await until(() => events.some((e) => e.type === "timing"));
    expect(seen[0]![0]!.content).toBe("be brief");
    await convo.close();
  });
});

describe("Conversation resilience", () => {
  it("reconnects the speech recogniser if it drops mid-call, and says so if it keeps failing", async () => {
    const sessions: Array<{ push: (e: SttEvent) => void; end: () => void }> = [];
    const adapter: SttAdapter = {
      async open() {
        const q: SttEvent[] = []; let wake: (() => void) | null = null; let ended = false;
        sessions.push({ push: (e) => { q.push(e); wake?.(); }, end: () => { ended = true; wake?.(); } });
        return { send() {}, async close() { ended = true; wake?.(); }, events: { async *[Symbol.asyncIterator]() { for (;;) { while (q.length) yield q.shift()!; if (ended) return; await new Promise<void>((r) => (wake = r)); } } } };
      },
    };
    const events: ServerEvent[] = [], audio: string[] = [];
    const convo = new Conversation({ stt: adapter, llm: fakeLlm("Okay."), tts: fakeTts(), language: "en", systemPrompt: "x", send: (e) => events.push(e), sendAudio: (c) => audio.push(new TextDecoder().decode(c)) });
    await convo.start();
    sessions[0]!.end(); // the recogniser connection drops
    await until(() => sessions.length === 2);
    sessions[1]!.push({ kind: "final", text: "still there?" }); // the new connection works
    await until(() => audio.length > 0);
    sessions[1]!.end(); await until(() => sessions.length === 3);
    sessions[2]!.end(); // third connection also drops: that was the last allowed reconnect
    await until(() => events.some((e) => e.type === "error" && /disconnected/.test((e as { message: string }).message)));
    await convo.close();
  });
});

describe("Conversation", () => {
  it("answers a finished utterance sentence by sentence, in order, and reports stage timings", async () => {
    const { convo, stt, events, audio } = setup();
    await convo.start();
    stt.fire({ kind: "final", text: "hi" });
    await until(() => events.some((e) => e.type === "timing"));
    expect(audio).toEqual(["Hello there.#0", "Hello there.#1", "Hello there.#2", "How are you today?#0", "How are you today?#1", "How are you today?#2"]);
    expect(events.filter((e) => e.type === "assistant").map((e) => (e as { text: string }).text)).toEqual(["Hello there.", "How are you today?"]);
    const t = events.find((e) => e.type === "timing") as Extract<ServerEvent, { type: "timing" }>;
    expect(t.totalMs).toBeGreaterThanOrEqual(0);
    expect(t.firstSentenceMs).toBeGreaterThanOrEqual(t.llmFirstTokenMs);
    await until(() => events.at(-1)?.type === "state");
    expect(events.filter((e) => e.type === "state").map((e) => (e as { state: string }).state)).toEqual(["thinking", "speaking", "listening"]);
    await convo.close();
  });

  it("opens with the AI disclosure when one is configured", async () => {
    const { convo, events, audio } = setup({ greeting: "I am an AI assistant." });
    await convo.start();
    await until(() => events.filter((e) => e.type === "assistant").length === 1);
    expect(audio[0]).toBe("I am an AI assistant.#0");
    await convo.close();
  });

  it("stops talking when the caller speaks over it, and remembers only what was actually said", async () => {
    const seen: ChatMessage[][] = [];
    const { convo, stt, events, audio } = setup({ llm: fakeLlm("First sentence here. Second sentence here. Third sentence here.", { seen }), tts: fakeTts(15, 4) });
    await convo.start();
    stt.fire({ kind: "final", text: "tell me" });
    await until(() => audio.some((a) => a.startsWith("First sentence here.#1")));
    stt.fire({ kind: "partial", text: "wait" });
    await until(() => events.some((e) => e.type === "clear"));
    const heardBefore = audio.length;
    await sleep(120);
    expect(audio.length).toBe(heardBefore); // nothing is sent after the interruption
    expect(events.some((e) => e.type === "barge_in")).toBe(true);
    expect(audio.some((a) => a.startsWith("Third"))).toBe(false);
    stt.fire({ kind: "final", text: "actually, what is the price" });
    await until(() => seen.length === 2);
    const second = seen[1]!;
    const lastAssistant = second.filter((m) => m.role === "assistant").at(-1);
    expect(lastAssistant?.content ?? "").not.toContain("Third sentence");
    expect(second.at(-1)).toEqual({ role: "user", content: "actually, what is the price" });
    await convo.close();
  });

  it("can be interrupted after the whole reply was sent, because the caller is still hearing the buffered audio", async () => {
    const seen: ChatMessage[][] = [];
    // Audio is sent instantly but each chunk plays for a full second, like a phone line draining a buffer.
    const { convo, stt, events } = setup({ llm: fakeLlm("First sentence here. Second sentence here.", { seen }), chunkMs: 1000 });
    await convo.start();
    stt.fire({ kind: "final", text: "tell me" });
    await until(() => events.some((e) => e.type === "assistant" && (e as { text: string }).text.startsWith("Second")));
    await sleep(20);
    expect(events.filter((e) => e.type === "state").at(-1)).toMatchObject({ state: "speaking" }); // sent everything, still talking
    stt.fire({ kind: "partial", text: "stop" });
    await until(() => events.some((e) => e.type === "clear"));
    expect(events.filter((e) => e.type === "state").at(-1)).toMatchObject({ state: "listening" });
    stt.fire({ kind: "final", text: "never mind" });
    await until(() => seen.length === 2);
    const remembered = seen[1]!.filter((m) => m.role === "assistant").map((m) => m.content).join(" ");
    expect(remembered).toContain("First sentence here.");
    expect(remembered).not.toContain("Second sentence here."); // it had not started playing yet
    await convo.close();
  });

  it("returns to listening only after the audio it sent has finished playing", async () => {
    const { convo, stt, events } = setup({ llm: fakeLlm("One short reply."), chunkMs: 40 }); // 3 chunks = 120 ms of audio
    await convo.start();
    stt.fire({ kind: "final", text: "hi" });
    await until(() => events.some((e) => e.type === "assistant"));
    expect(events.filter((e) => e.type === "state").at(-1)).toMatchObject({ state: "speaking" });
    await until(() => events.filter((e) => e.type === "state").at(-1)?.state === "listening", 1000);
    await convo.close();
  });

  it("treats a pause mid-sentence as one question when the AI has not spoken yet", async () => {
    const seen: ChatMessage[][] = [];
    const { convo, stt, events } = setup({ llm: fakeLlm("Okay then. Sure thing.", { delayMs: 60, seen }), tts: fakeTts(5, 2) });
    await convo.start();
    stt.fire({ kind: "final", text: "Wait, actually," });
    await sleep(15); // the model is still thinking, nothing has been said
    stt.fire({ kind: "final", text: "what about the premium plan?" });
    await until(() => events.some((e) => e.type === "timing"));
    const last = seen.at(-1)!;
    expect(last.filter((m) => m.role === "user")).toEqual([{ role: "user", content: "Wait, actually, what about the premium plan?" }]);
    const users = events.filter((e) => e.type === "user") as Array<{ text: string; replace?: boolean }>;
    expect(users.map((u) => u.replace === true)).toEqual([false, true]);
    expect(users.at(-1)!.text).toBe("Wait, actually, what about the premium plan?");
    await convo.close();
  });

  it("does not merge once the AI has started speaking: that is a real interruption", async () => {
    const seen: ChatMessage[][] = [];
    const { convo, stt, audio } = setup({ llm: fakeLlm("A first long sentence here. And another one here.", { seen }), tts: fakeTts(15, 4) });
    await convo.start();
    stt.fire({ kind: "final", text: "first question" });
    await until(() => audio.length >= 2);
    stt.fire({ kind: "final", text: "second question" });
    await until(() => seen.length === 2);
    expect(seen[1]!.filter((m) => m.role === "user").map((m) => m.content)).toEqual(["first question", "second question"]);
    await convo.close();
  });

  it("can also be interrupted the instant the recogniser hears the caller start, before any words arrive", async () => {
    const { convo, stt, events, audio } = setup({ tts: fakeTts(15, 6) });
    await convo.start();
    stt.fire({ kind: "final", text: "hi" });
    await until(() => audio.length >= 2);
    stt.fire({ kind: "speech_started" });
    await until(() => events.some((e) => e.type === "clear"));
    await convo.close();
  });

  it("speaks the fallback message if the model fails before the caller hears anything", async () => {
    const { convo, stt, events, audio } = setup({ llm: fakeLlm("", { fail: true }), fallback: "Sorry, I am having trouble." });
    await convo.start();
    stt.fire({ kind: "final", text: "hello" });
    await until(() => audio.some((a) => a.startsWith("Sorry, I am having trouble.")));
    expect(events.some((e) => e.type === "error")).toBe(true);
    await convo.close();
  });

  it("ignores partial transcripts while it is listening and sends no audio after close", async () => {
    const { convo, stt, events, audio } = setup();
    await convo.start();
    stt.fire({ kind: "partial", text: "hel" });
    await sleep(30);
    expect(events.some((e) => e.type === "clear")).toBe(false);
    expect(audio).toEqual([]);
    await convo.close();
  });
});

const HANDOFF = { enabled: { person: true, complaint: true, payment: true } };

describe("Conversation: the call record", () => {
  it("records both sides with times, in order", async () => {
    const { convo, stt, events } = setup({ greeting: "Hi." });
    await convo.start();
    await until(() => events.some((e) => e.type === "assistant")); // let the greeting finish before the caller speaks
    stt.fire({ kind: "final", text: "what is the price" });
    await until(() => events.some((e) => e.type === "timing"));
    const t = convo.transcript();
    expect(t.map((s) => `${s.speaker}: ${s.text}`)).toEqual(["ai: Hi.", "caller: what is the price", "ai: Hello there.", "ai: How are you today?"]);
    for (const s of t) expect(s.endMs).toBeGreaterThanOrEqual(s.startMs);
    expect(convo.durationMs()).toBeGreaterThanOrEqual(0);
    await convo.close();
  });
  it("marks a sentence the caller talked over as interrupted, and drops what was never spoken", async () => {
    const { convo, stt, events } = setup({ llm: fakeLlm("One sentence here. Two sentence here. Three sentence here."), tts: fakeTts(15, 3), chunkMs: 100 });
    await convo.start();
    stt.fire({ kind: "final", text: "tell me everything" });
    await until(() => events.some((e) => e.type === "assistant"));
    stt.fire({ kind: "speech_started" });
    await until(() => events.some((e) => e.type === "barge_in"));
    const ai = convo.transcript().filter((s) => s.speaker === "ai");
    expect(ai.some((s) => s.interrupted)).toBe(true);
    expect(ai.map((s) => s.text)).not.toContain("Three sentence here.");
    await convo.close();
  });
});

describe("Conversation: handing the call to a person", () => {
  it("says the hand-over message instead of asking the AI, tells the client, then stops answering", async () => {
    const seen: ChatMessage[][] = [];
    const { convo, stt, events } = setup({ handoff: HANDOFF, llm: fakeLlm("I should not be asked.", { seen }) });
    await convo.start();
    stt.fire({ kind: "final", text: "I want to talk to a human agent please" });
    await until(() => events.some((e) => e.type === "handoff"));
    await sleep(40);
    expect(events.find((e) => e.type === "handoff")).toMatchObject({ reason: "person", message: expect.stringContaining("colleague") });
    expect(seen).toHaveLength(0);
    expect(convo.handoffReason()).toBe("person");
    const before = events.length;
    stt.fire({ kind: "final", text: "hello are you there" });
    await sleep(60);
    expect(events.slice(before).filter((e) => e.type === "user" || e.type === "assistant")).toEqual([]);
    expect(seen).toHaveLength(0);
    await convo.close();
  });
  it("answers in Hindi when the caller asked in Hindi", async () => {
    const { convo, stt, events } = setup({ handoff: HANDOFF });
    await convo.start();
    stt.fire({ kind: "final", text: "मुझे किसी इंसान से बात करनी है" });
    await sleep(30);
    // not every Hindi phrasing is a handoff; the English phrase below is, and the message follows the caller's script
    stt.fire({ kind: "final", text: "connect me to a manager" });
    await until(() => events.some((e) => e.type === "handoff"));
    await convo.close();
  });
  it("hands over on a payment problem but not on a plain question about refunds", async () => {
    const a = setup({ handoff: HANDOFF });
    await a.convo.start();
    a.stt.fire({ kind: "final", text: "what is your refund policy" });
    await until(() => a.events.some((e) => e.type === "timing"));
    expect(a.convo.handoffReason()).toBeNull();
    await a.convo.close();
    const b = setup({ handoff: HANDOFF });
    await b.convo.start();
    b.stt.fire({ kind: "final", text: "money was deducted twice from my account" });
    await until(() => b.events.some((e) => e.type === "handoff"));
    expect(b.convo.handoffReason()).toBe("payment");
    await b.convo.close();
  });
  it("respects the organisation turning complaint hand-over off", async () => {
    const { convo, stt, events } = setup({ handoff: { enabled: { person: true, complaint: false, payment: true } } });
    await convo.start();
    stt.fire({ kind: "final", text: "this is terrible service, I want to file a complaint" });
    await until(() => events.some((e) => e.type === "timing"));
    expect(events.some((e) => e.type === "handoff")).toBe(false);
    await convo.close();
  });
  it("hands over after the AI fails twice in a row", async () => {
    const { convo, stt, events } = setup({ handoff: HANDOFF, llm: fakeLlm("x", { fail: true }), fallback: "Sorry, one moment." });
    await convo.start();
    stt.fire({ kind: "final", text: "first question" });
    await until(() => events.filter((e) => e.type === "assistant").length >= 1);
    expect(events.some((e) => e.type === "handoff")).toBe(false);
    stt.fire({ kind: "final", text: "second question" });
    await until(() => events.some((e) => e.type === "handoff"));
    expect(events.find((e) => e.type === "handoff")).toMatchObject({ reason: "pipeline_error" });
    await convo.close();
  });
  it("never hands over when the service has no hand-over settings (a plain test call)", async () => {
    const { convo, stt, events } = setup();
    await convo.start();
    stt.fire({ kind: "final", text: "let me talk to a human" });
    await until(() => events.some((e) => e.type === "timing"));
    expect(events.some((e) => e.type === "handoff")).toBe(false);
    await convo.close();
  });
});

describe("Conversation: the speaker's gender", () => {
  it("says a woman's Hindi forms in a female voice, even if the model wrote a man's", async () => {
    const tts = { ...fakeTts(), gender: "female" as const };
    const { convo, stt, events } = setup({ llm: fakeLlm("मैं आपकी क्या मदद कर सकता हूँ?"), tts, greeting: "ठीक है, मैं आपकी बात करवाता हूँ।" });
    await convo.start();
    await until(() => events.some((e) => e.type === "assistant"));
    stt.fire({ kind: "final", text: "कैसे हैं आप" });
    await until(() => events.some((e) => e.type === "timing"));
    const said = events.filter((e) => e.type === "assistant").map((e) => (e as { text: string }).text);
    expect(said).toEqual(["ठीक है, मैं आपकी बात करवाती हूँ।", "मैं आपकी क्या मदद कर सकती हूँ?"]);
    await convo.close();
  });
  it("leaves the text alone when the voice has no gender set", async () => {
    const { convo, stt, events } = setup({ llm: fakeLlm("मैं आपकी क्या मदद कर सकता हूँ?") });
    await convo.start();
    stt.fire({ kind: "final", text: "कैसे हैं आप" });
    await until(() => events.some((e) => e.type === "timing"));
    expect(events.filter((e) => e.type === "assistant").map((e) => (e as { text: string }).text)).toEqual(["मैं आपकी क्या मदद कर सकता हूँ?"]);
    await convo.close();
  });
});

describe("Conversation yes after an offer to connect a person", () => {
  const OFFER = "इसकी जानकारी अभी मेरे पास नहीं है। अगर आप चाहें, तो मैं आपको अपने साथी से जोड़ देता हूँ।";
  const handoff = { enabled: { person: true, complaint: true, payment: true } };
  const talk = async (second: string, offer = OFFER) => {
    const seen: ChatMessage[][] = [];
    const { convo, stt, events } = setup({ llm: fakeLlm(offer, { seen }), handoff });
    await convo.start();
    stt.fire({ kind: "final", text: "और दूसरे प्लान बताइए" });
    await until(() => events.filter((e) => e.type === "timing").length === 1);
    await sleep(30);
    stt.fire({ kind: "final", text: second });
    await sleep(300);
    const out = { handedOff: events.some((e) => e.type === "handoff"), asks: seen.length };
    await convo.close();
    return out;
  };

  it("hands the call over when the caller agrees, even if the recogniser garbled part of it", async () => {
    expect(await talk("ठीक है जोड दीजाँ")).toEqual({ handedOff: true, asks: 1 });
    expect(await talk("हाँ जी")).toEqual({ handedOff: true, asks: 1 });
  });

  it("does not hand over when the caller says no, or asks something else", async () => {
    expect((await talk("नहीं, रहने दीजिए")).handedOff).toBe(false);
    expect((await talk("हाँ लेकिन पहले बताइए कि बिज़नेस प्लान में कितने यूज़र मिलते हैं")).handedOff).toBe(false);
  });

  it("does not treat a plain yes as a request when nothing was offered", async () => {
    expect((await talk("हाँ", "जी बिल्कुल। Starter प्लान एक हज़ार नौ सौ निन्यानवे रुपये का है।")).handedOff).toBe(false);
  });

  it("really hands the call over when the AI itself says it is connecting the caller", async () => {
    const { convo, stt, events } = setup({ llm: fakeLlm("मैं अभी आपको अपने साथी से जोड़ देता हूँ।"), handoff });
    await convo.start();
    stt.fire({ kind: "final", text: "मुझे किसी से बात करनी है, बहुत ज़रूरी है" });
    await until(() => events.some((e) => e.type === "handoff"));
    expect(events.find((e) => e.type === "handoff")).toMatchObject({ reason: "person" });
    expect(convo.handoffReason()).toBe("person");
    await convo.close();
  });
});

describe("Conversation: the language chosen for the call is final", () => {
  const twice = (first: string, second: string): LlmAdapter & { asks: string[][] } => {
    const a = { asks: [] as string[][], respond: () => (async function* () {})(), async *chat({ messages }: { messages: ChatMessage[] }) { a.asks.push(messages.map((m) => m.content)); yield a.asks.length === 1 ? first : second; } };
    return a;
  };
  const said = (events: ServerEvent[]) => events.filter((e) => e.type === "assistant").map((e) => (e as { text: string }).text);

  it("asks again, firmly, when an English call gets a Hindi answer, and speaks only the English one", async () => {
    const llm = twice("नमस्ते! मैं आपकी मदद कर सकती हूँ।", "Hello! How can I help you today?");
    const { convo, stt, events } = setup({ llm, language: "en" });
    await convo.start();
    stt.fire({ kind: "final", text: "Namaste, what plans do you have?" });
    await until(() => events.some((e) => e.type === "timing"));
    expect(said(events)).toEqual(["Hello!", "How can I help you today?"]);
    expect(llm.asks).toHaveLength(2);
    expect(llm.asks[1]!.at(-1)).toMatch(/reply in English only/);
    await convo.close();
  });

  it("says a short apology in English if the model keeps answering in Hindi", async () => {
    const { convo, stt, events } = setup({ llm: fakeLlm("नमस्ते! मैं आपकी मदद कर सकती हूँ।"), language: "en" });
    await convo.start();
    stt.fire({ kind: "final", text: "What plans do you have?" });
    await until(() => said(events).length > 0);
    expect(said(events)).toEqual(["Sorry, could you say that again?"]);
    await convo.close();
  });

  it("keeps a Hindi call in Hindi", async () => {
    const llm = twice("The Business plan costs 4,999 rupees per month.", "जी, Business प्लान 4,999 रुपये प्रति माह का है।");
    const { convo, stt, events } = setup({ llm, language: "hi" });
    await convo.start();
    stt.fire({ kind: "final", text: "What is the price?" });
    await until(() => events.some((e) => e.type === "timing"));
    expect(said(events)).toEqual(["जी, Business प्लान चार हज़ार नौ सौ निन्यानवे रुपये प्रति माह का है।"]);
    await convo.close();
  });
});
