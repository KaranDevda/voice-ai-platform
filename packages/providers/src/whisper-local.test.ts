import { describe, expect, it } from "vitest";
import type { SttEvent } from "./types";
import { createLocalWhisper, isPhantom } from "./whisper-local";

const RATE = 16_000;
const tone = (ms: number, amp = 0.2) => Int16Array.from({ length: (RATE * ms) / 1000 }, (_, i) => Math.round(Math.sin(i / 6) * amp * 32767));
const quiet = (ms: number) => new Int16Array((RATE * ms) / 1000);
const bytes = (a: Int16Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeWhisper(reply: (form: FormData) => string, seen: FormData[] = []): typeof fetch {
  return (async (_u: unknown, init?: RequestInit) => {
    const form = init?.body as FormData;
    seen.push(form);
    return new Response(JSON.stringify({ text: reply(form) }), { status: 200 });
  }) as typeof fetch;
}
async function run(audio: Int16Array, f: typeof fetch, language: "en" | "hi" | "en-hi" = "en", extra: Partial<Parameters<typeof createLocalWhisper>[0]> = {}) {
  const stt = await createLocalWhisper({ baseUrl: "http://w", fetch: f, ...extra }).open({ language });
  const events: SttEvent[] = [];
  const reader = (async () => { for await (const e of stt.events) events.push(e); })();
  for (let i = 0; i < audio.length; i += 320) { stt.send(bytes(audio.subarray(i, i + 320))); }
  await stt.close();
  await reader;
  return events;
}

describe("local Whisper speech-to-text", () => {
  it("reports speech starting, then the transcript, for each utterance", async () => {
    const ev = await run(Int16Array.from([...quiet(500), ...tone(1500), ...quiet(900)]), fakeWhisper(() => " What is the price? "));
    expect(ev).toEqual([{ kind: "speech_started" }, { kind: "final", text: "What is the price?", language: "en" }]);
  });

  it("sends the language and a brand-name hint, as a 16 kHz WAV", async () => {
    const seen: FormData[] = [];
    await run(Int16Array.from([...quiet(500), ...tone(2400), ...quiet(900)]), fakeWhisper(() => "namaste", seen), "hi");
    const form = seen[0]!;
    expect(form.get("language")).toBe("hi");
    expect(form.get("prompt")).toContain("बिज़्फी");
    const wav = new Uint8Array(await (form.get("file") as Blob).arrayBuffer());
    expect(String.fromCharCode(...wav.subarray(0, 4))).toBe("RIFF");
    expect(new DataView(wav.buffer, wav.byteOffset).getUint32(24, true)).toBe(16_000);
  });

  it("leaves the brand hint off short utterances, where it makes Whisper repeat itself", async () => {
    const seen: FormData[] = [];
    await run(Int16Array.from([...quiet(500), ...tone(1000), ...quiet(900)]), fakeWhisper(() => "thanks", seen), "en");
    expect(seen[0]!.get("prompt")).toBeNull();
  });

  it("detects the language itself for mixed English and Hindi", async () => {
    const seen: FormData[] = [];
    await run(Int16Array.from([...quiet(500), ...tone(1500), ...quiet(900)]), fakeWhisper(() => "ok then", seen), "en-hi");
    expect(seen[0]!.get("language")).toBe("auto");
  });

  it("transcribes two utterances in order even if the second finishes first", async () => {
    let n = 0;
    const slowFirst: typeof fetch = (async () => {
      const mine = ++n;
      await sleep(mine === 1 ? 80 : 5);
      return new Response(JSON.stringify({ text: `utterance ${mine}` }), { status: 200 });
    }) as typeof fetch;
    const audio = Int16Array.from([...quiet(300), ...tone(1200), ...quiet(700), ...tone(1200), ...quiet(900)]);
    const ev = await run(audio, slowFirst);
    expect(ev.filter((e) => e.kind === "final").map((e) => (e as { text: string }).text)).toEqual(["utterance 1", "utterance 2"]);
  });

  it("drops Whisper's invented text on silence and noise, but keeps real short answers when they are long enough", () => {
    expect(isPhantom("", 2000)).toBe(true);
    expect(isPhantom("[BLANK_AUDIO]", 2000)).toBe(true);
    expect(isPhantom("(music)", 3000)).toBe(true);
    expect(isPhantom("...", 3000)).toBe(true);
    expect(isPhantom("Thank you.", 600)).toBe(true);
    expect(isPhantom("Thank you.", 2500)).toBe(false);
    expect(isPhantom("What is the price of the business plan?", 600)).toBe(false);
    expect(isPhantom("नमस्ते", 700)).toBe(false);
    for (const noise of ["Shh.", "shhh", "Hmm.", "Uh...", "Um,", "Ah!", "हम्म"]) expect(isPhantom(noise, 2500)).toBe(true);
    expect(isPhantom("झाल", 300)).toBe(true);
    expect(isPhantom("हाँ", 300)).toBe(false);
    expect(isPhantom("नहीं", 300)).toBe(false);
    expect(isPhantom("Hmm, what is the price?", 900)).toBe(false);
    expect(isPhantom("She sells", 900)).toBe(false);
    // Hindi sentences that contain a letter that is also a noise sound must never be dropped (\W matches Hindi letters).
    for (const q of ["आप कौन सी भाशारे बोलते हैं?", "आप कौन सी भाषाएँ बोलते हैं?", "शुरू कैसे करें?", "आपकी सहायता के लिए धन्यवाद, मुझे प्लान के बारे में बताइए", "मुझे आह नहीं, बिल की जानकारी चाहिए"]) expect(isPhantom(q, 300)).toBe(false);
    expect(isPhantom("श", 2000)).toBe(true);
    expect(isPhantom("धन्यवाद", 600)).toBe(true);
    expect(isPhantom("धन्यवाद, लेकिन मेरी बात अभी पूरी नहीं हुई है", 600)).toBe(false);
  });

  it("keeps going if one transcription fails", async () => {
    let n = 0;
    const flaky: typeof fetch = (async () => (++n === 1 ? new Response("boom", { status: 500 }) : new Response(JSON.stringify({ text: "second one" }), { status: 200 }))) as typeof fetch;
    const audio = Int16Array.from([...quiet(300), ...tone(1200), ...quiet(700), ...tone(1200), ...quiet(900)]);
    const ev = await run(audio, flaky);
    expect(ev.filter((e) => e.kind === "final").map((e) => (e as { text: string }).text)).toEqual(["second one"]);
  });

  describe("rooms with other people", () => {
    const say = (amp: number) => [...tone(1200, amp), ...quiet(700)];
    const talk = (...amps: number[]) => Int16Array.from([...quiet(400), ...amps.flatMap(say), ...quiet(300)]);
    const numbered = (): typeof fetch => { let n = 0; return (async () => new Response(JSON.stringify({ text: `line ${++n}` }), { status: 200 })) as typeof fetch; };
    const finals = (ev: SttEvent[]) => ev.filter((e) => e.kind === "final").map((e) => (e as { text: string }).text);

    it("ignores speech clearly quieter than the speaker (people further from the microphone)", async () => {
      const ev = await run(talk(0.3, 0.06, 0.3), numbered(), "en", { closeMic: {} });
      expect(finals(ev)).toEqual(["line 1", "line 2"]); // the quiet middle voice never reached the model
    });

    it("hears everyone when close-mic mode is off", async () => {
      const ev = await run(talk(0.3, 0.06, 0.3), numbered(), "en");
      expect(finals(ev)).toHaveLength(3);
    });

    it("keeps working if the speaker moves back from the mic: after three quiet utterances in a row it relearns their level", async () => {
      const ev = await run(talk(0.4, 0.05, 0.05, 0.05, 0.05), numbered(), "en", { closeMic: {} });
      expect(finals(ev)).toEqual(["line 1", "line 2"]); // 1st loud accepted, three dropped, then the quiet speaker is the new reference
    });

    it("tolerates a normal change in speaking volume", async () => {
      const ev = await run(talk(0.3, 0.2, 0.25), numbered(), "en", { closeMic: {} });
      expect(finals(ev)).toHaveLength(3);
    });
  });

  describe("transcripts Whisper is unsure of", () => {
    const withConfidence = (avg_logprob: number, no_speech_prob = 0.01): typeof fetch =>
      (async () => new Response(JSON.stringify({ text: "something said", segments: [{ avg_logprob, no_speech_prob }] }), { status: 200 })) as typeof fetch;
    const audio = Int16Array.from([...quiet(400), ...tone(1500), ...quiet(900)]);
    const heard = (ev: SttEvent[]) => ev.filter((e) => e.kind === "final").length;
    const always = { minConfidence: { when: "always" as const } };

    it("keeps clear speech", async () => { expect(heard(await run(audio, withConfidence(-0.2), "en", always))).toBe(1); });
    it("drops mumbled or distant speech (very low confidence)", async () => { expect(heard(await run(audio, withConfidence(-1.6), "en", always))).toBe(0); });
    it("drops audio Whisper thinks is not speech at all", async () => { expect(heard(await run(audio, withConfidence(-0.3, 0.92), "en", always))).toBe(0); });
    it("reports why it dropped something, for tuning", async () => {
      const seen: string[] = [];
      await run(audio, withConfidence(-1.6), "en", { ...always, onTranscribed: (i) => { if (i.dropped) seen.push(i.dropped); } });
      expect(seen).toEqual(["low confidence"]);
    });

    it("asks for confidence only about quieter-than-usual speech, to keep normal answers fast", async () => {
      const formats: string[] = [];
      const f: typeof fetch = (async (_u: unknown, init?: RequestInit) => { formats.push((init!.body as FormData).get("response_format") as string); return new Response(JSON.stringify({ text: "something said" }), { status: 200 }); }) as typeof fetch;
      const say = (amp: number) => [...tone(1800, amp), ...quiet(700)];
      await run(Int16Array.from([...quiet(400), ...say(0.3), ...say(0.3), ...say(0.15), ...quiet(300)]), f, "en", { closeMic: {}, minConfidence: {} });
      expect(formats).toEqual(["json", "json", "verbose_json"]); // only the quieter third utterance was checked
    });
  });

  it("a voice quieter than the speaker's does not interrupt the AI, but the speaker does", async () => {
    const starts: SttEvent[] = [];
    const say = (amp: number) => [...tone(1200, amp), ...quiet(700)];
    const audio = Int16Array.from([...quiet(400), ...say(0.3), ...say(0.06), ...say(0.3), ...quiet(300)]);
    const ev = await run(audio, (async () => new Response(JSON.stringify({ text: "something said" }), { status: 200 })) as typeof fetch, "en", { closeMic: {} });
    starts.push(...ev.filter((e) => e.kind === "speech_started"));
    expect(starts).toHaveLength(2); // the first and third (the speaker), not the quiet one in the middle
  });
});
