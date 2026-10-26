import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeepgramLive } from "./deepgram-live";
import type { SttEvent } from "./types";

class FakeWs {
  static last: FakeWs;
  readyState = 1;
  binaryType = "";
  onopen: (() => void) | null = null;
  onmessage: ((m: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: unknown[] = [];
  constructor(public url: string, public protocols: string[]) { FakeWs.last = this; queueMicrotask(() => this.onopen?.()); }
  send(d: unknown) { this.sent.push(d); }
  close() { this.readyState = 3; this.onclose?.(); }
  say(o: object) { this.onmessage?.({ data: JSON.stringify(o) }); }
}
const result = (text: string, o: { is_final?: boolean; speech_final?: boolean } = {}) => ({ type: "Results", is_final: false, speech_final: false, channel: { alternatives: [{ transcript: text }] }, ...o });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function open(flushAfterMs = 40) {
  vi.stubGlobal("WebSocket", FakeWs);
  const session = await createDeepgramLive({ apiKey: "k", flushAfterMs }).open({ language: "en" });
  const events: SttEvent[] = [];
  void (async () => { for await (const e of session.events) events.push(e); })();
  return { session, ws: FakeWs.last, events };
}
afterEach(() => vi.unstubAllGlobals());

describe("Deepgram live speech-to-text", () => {
  it("authenticates without putting the key in the address", async () => {
    const { ws, session } = await open();
    expect(ws.protocols).toEqual(["token", "k"]);
    expect(ws.url).not.toContain("k=");
    expect(ws.url).toContain("model=nova-3");
    await session.close();
  });

  it("sends one final per turn with all finished pieces joined, and partials while speaking", async () => {
    const { ws, events, session } = await open();
    ws.say(result("what is the"));
    ws.say(result("what is the price", { is_final: true }));
    ws.say(result("of the business plan", { is_final: true, speech_final: true }));
    await sleep(10);
    expect(events.filter((e) => e.kind === "final")).toEqual([{ kind: "final", text: "what is the price of the business plan", language: "en" }]);
    expect(events.some((e) => e.kind === "partial")).toBe(true);
    await session.close();
  });

  it("still sends finished words when Deepgram never sets speech_final", async () => {
    const { ws, events, session } = await open(40);
    ws.say(result("tell me about the premium plan", { is_final: true }));
    await sleep(120);
    expect(events.filter((e) => e.kind === "final")).toEqual([{ kind: "final", text: "tell me about the premium plan", language: "en" }]);
    await session.close();
  });

  it("does not cut the caller off while new words keep arriving", async () => {
    const { ws, events, session } = await open(60);
    ws.say(result("tell me", { is_final: true }));
    await sleep(30);
    ws.say(result("about the premium", {}));
    await sleep(40); // the first timer would have fired by now if the new words had not cancelled it
    ws.say(result("about the premium plan", { is_final: true, speech_final: true }));
    await sleep(10);
    expect(events.filter((e) => e.kind === "final").map((e) => (e as { text: string }).text)).toEqual(["tell me about the premium plan"]);
    await session.close();
  });

  it("does not send the same words twice when the flag arrives after the timer", async () => {
    const { ws, events, session } = await open(20);
    ws.say(result("hello there", { is_final: true }));
    await sleep(60);
    ws.say(result("", { speech_final: true }));
    await sleep(10);
    expect(events.filter((e) => e.kind === "final")).toHaveLength(1);
    await session.close();
  });

  it("flushes on UtteranceEnd and reports speech starting", async () => {
    const { ws, events, session } = await open(10_000);
    ws.say({ type: "SpeechStarted" });
    ws.say(result("hi there", { is_final: true }));
    ws.say({ type: "UtteranceEnd" });
    await sleep(10);
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["speech_started", "final", "end_of_speech"]));
    await session.close();
  });
});
