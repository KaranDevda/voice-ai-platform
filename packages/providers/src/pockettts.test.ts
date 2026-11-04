import { describe, expect, it } from "vitest";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPocketTts, detectPocketLanguage, linearToMulaw, pcmToMulaw8k, kokoroHindiVoiceFor, splitByScript, voiceFileStem } from "./pockettts";

function wav(samples: number[], rate = 24_000): Uint8Array {
  const pcm = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => pcm.writeInt16LE(s, i * 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** A fake server that streams `bytes` in awkward slices, including odd-sized ones that split a sample. */
function fakeFetch(bytes: Uint8Array, slice: number, seen: { form?: FormData } = {}): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    seen.form = init?.body as FormData;
    const stream = new ReadableStream<Uint8Array>({
      start(c) { for (let i = 0; i < bytes.length; i += slice) c.enqueue(bytes.subarray(i, i + slice)); c.close(); },
    });
    return new Response(stream, { status: 200 });
  }) as typeof fetch;
}

describe("µ-law encoding (G.711)", () => {
  it("matches the standard reference values", () => {
    expect(linearToMulaw(0)).toBe(0xff);
    expect(linearToMulaw(32767)).toBe(0x80);
    expect(linearToMulaw(-32768)).toBe(0x00);
    expect(linearToMulaw(1000)).toBe(0xce);
  });
  it("turns 24 kHz into 8 kHz by taking one output sample per three input samples", () => {
    expect(pcmToMulaw8k(new Int16Array(240), 24_000)).toHaveLength(80);
  });
});

describe("Pocket TTS adapter", () => {
  const samples = Array.from({ length: 2400 }, (_, i) => Math.round(Math.sin(i / 8) * 8000));
  const bytes = wav(samples);

  it("streams phone-format audio regardless of how the network slices the WAV", async () => {
    for (const slice of [1, 7, 45, 1000, 99999]) {
      const tts = createPocketTts({ baseUrl: "http://tts", fetch: fakeFetch(bytes, slice) });
      const frames: Uint8Array[] = [];
      for await (const f of tts.synthesize({ text: "hi", providerVoiceId: "alba" })) frames.push(f);
      expect({ slice, bytes: Buffer.concat(frames).length }).toEqual({ slice, bytes: 800 }); // 2400 samples at 24 kHz = 800 at 8 kHz
    }
  });

  it("returns a playable WAV for the studio", async () => {
    const tts = createPocketTts({ baseUrl: "http://tts", fetch: fakeFetch(bytes, 333) });
    const r = await tts.speak({ text: "hi", voiceId: "alba", format: "mp3" });
    expect(r.mime).toBe("audio/wav");
    expect(Buffer.from(r.audio.subarray(0, 4)).toString()).toBe("RIFF");
    expect(r.audio.length).toBe(44 + 4800);
  });

  it("sends a stored clone by web address and a built-in voice by name", async () => {
    const seen: { form?: FormData } = {};
    const tts = createPocketTts({ baseUrl: "http://tts", fetch: fakeFetch(bytes, 100, seen), voiceUrl: (id) => `http://files/${id}.safetensors?sig=x` });
    await tts.speak({ text: "hi", voiceId: "alba" });
    expect(seen.form?.get("voice_url")).toBe("alba");
    const id = "0b9c1f5e-8a5d-4d62-9a30-6c3f6a7d1e11";
    await tts.speak({ text: "hi", voiceId: id });
    expect(seen.form?.get("voice_url")).toBe(`http://files/${id}.safetensors?sig=x`);
  });

  it("refuses ids that are neither built-in nor a clone id, so a voice name can never become a path", async () => {
    const tts = createPocketTts({ baseUrl: "http://tts", fetch: fakeFetch(bytes, 100), voiceUrl: (id) => `http://files/${id}` });
    await expect(tts.speak({ text: "hi", voiceId: "../../etc/passwd" })).rejects.toThrow("unknown voice");
  });

  it("only accepts WAV recordings for cloning", async () => {
    const tts = createPocketTts({ baseUrl: "http://tts", binPath: "/nonexistent", voicesDir: "/tmp/x" });
    await expect(tts.cloneVoice({ label: "a", samples: [{ name: "a.webm", mime: "audio/webm", data: new Uint8Array(200) }] })).rejects.toThrow("WAV");
  });

  describe("two languages", () => {
    const hiBytes = wav(samples);
    /** Records which server and form each request went to. */
    function twoServers(audioFor?: (text: string) => Uint8Array) {
      const calls: { url: string; voice: string | null; text: string }[] = [];
      const f = (async (url: string, init?: RequestInit) => {
        const form = init?.body as FormData;
        const text = form.get("text") as string;
        calls.push({ url, voice: form.get("voice_url") as string | null, text });
        return new Response(new Uint8Array(audioFor ? audioFor(text) : hiBytes), { status: 200 });
      }) as unknown as typeof fetch;
      return { calls, f };
    }
    const cfg = (extra = {}) => ({ baseUrl: "http://en", languages: { hi: { baseUrl: "http://hi", exportArgs: ["--config", "hf://x/hi.yaml"] } }, voiceUrl: (id: string, l: string) => `http://files/${voiceFileStem(id, l as "en" | "hi")}.safetensors`, ...extra });
    const ID = "0b9c1f5e-8a5d-4d62-9a30-6c3f6a7d1e11";

    it("tells Hindi from English by script", () => {
      expect(detectPocketLanguage("Hello there")).toBe("en");
      expect(detectPocketLanguage("नमस्ते, कैसे हैं?")).toBe("hi");
      expect(detectPocketLanguage("Your plan is ₹4999, नमस्ते")).toBe("hi");
      expect(detectPocketLanguage("")).toBe("en");
    });

    it("cuts a mixed sentence into runs by script, keeping punctuation with the run before it", () => {
      expect(splitByScript("जी, Business plan की कीमत चार हज़ार है।").map((r) => [r.language, r.text])).toEqual([["hi", "जी, "], ["en", "Business plan "], ["hi", "की कीमत चार हज़ार है।"]]);
      expect(splitByScript("Hello there.")).toEqual([{ language: "en", text: "Hello there." }]);
      expect(splitByScript("नमस्ते!")).toEqual([{ language: "hi", text: "नमस्ते!" }]);
      expect(splitByScript('"Hello" जी')).toEqual([{ language: "en", text: '"Hello" ' }, { language: "hi", text: "जी" }]);
      expect(splitByScript("")).toEqual([]);
      expect(splitByScript("...")).toEqual([{ language: "en", text: "..." }]);
      expect(splitByScript(splitByScript("a b नमस्ते c").map((r) => r.text).join("")).map((r) => r.text).join("")).toBe("a b नमस्ते c"); // nothing lost
    });

    it("speaks a mixed sentence with the right model for each run, and plays the runs in the right order", async () => {
      // Each run gets its own recognisable sound, so the order of the joined audio can be checked.
      const level = (text: string) => (text.startsWith("जी") ? 1000 : text.startsWith("Kubernetes") ? 2000 : 3000);
      const { calls, f } = twoServers((text) => wav(Array.from({ length: 100 }, () => level(text))));
      const tts = createPocketTts({ ...cfg(), fetch: f });
      const r = await tts.speak({ text: "जी, Kubernetes cluster की कीमत है।", voiceId: ID });
      const by = (t: string) => calls.find((c) => c.text.trim().startsWith(t))!;
      expect(by("जी").url).toBe("http://hi/tts");
      expect(by("Kubernetes").url).toBe("http://en/tts");
      expect(by("की").url).toBe("http://hi/tts");
      expect(by("Kubernetes").voice).toBe(`http://files/${ID}.safetensors`);     // English run: the speaker's English voice file
      expect(by("जी").voice).toBe(`http://files/${ID}.hi.safetensors`);       // Hindi runs: the same speaker's Hindi voice file
      const pcm = new Int16Array(r.audio.buffer, r.audio.byteOffset + 44, (r.audio.length - 44) / 2);
      expect([pcm[0], pcm[100], pcm[200]]).toEqual([1000, 2000, 3000]);          // Hindi, then English, then Hindi
      expect(pcm.length).toBe(300);
    });

    it("sends each sentence to the right model, with that model's own voice file", async () => {
      const { calls, f } = twoServers();
      const tts = createPocketTts({ ...cfg(), fetch: f });
      await tts.speak({ text: "Hello there", voiceId: ID });
      await tts.speak({ text: "नमस्ते", voiceId: ID });
      expect(calls.map((c) => [c.url, c.voice])).toEqual([["http://en/tts", `http://files/${ID}.safetensors`], ["http://hi/tts", `http://files/${ID}.hi.safetensors`]]);
    });

    it("speaks Hindi in the Hindi default voice for a built-in English voice name", async () => {
      const { calls, f } = twoServers();
      const tts = createPocketTts({ ...cfg(), fetch: f });
      await tts.speak({ text: "नमस्ते", voiceId: "alba" });
      expect(calls[0]).toMatchObject({ url: "http://hi/tts", voice: null });
    });

    it("falls back to the default Hindi voice, and says so, when a clone has no Hindi file yet", async () => {
      const { calls, f } = twoServers();
      const missing: string[] = [];
      const tts = createPocketTts({ ...cfg({ voiceAvailable: async (_id: string, l: string) => l === "en", onVoiceMissing: (id: string, l: string) => missing.push(`${id}:${l}`) }), fetch: f });
      await tts.speak({ text: "नमस्ते", voiceId: ID });
      await tts.speak({ text: "Hello", voiceId: ID });
      expect(calls[0]).toMatchObject({ url: "http://hi/tts", voice: null });
      expect(calls[1]!.voice).toBe(`http://files/${ID}.safetensors`);
      expect(missing).toEqual([`${ID}:hi`]);
    });

    it("refuses Hindi clearly when no Hindi model is configured", async () => {
      const { f } = twoServers();
      const tts = createPocketTts({ baseUrl: "http://en", fetch: f });
      await expect(tts.speak({ text: "नमस्ते", voiceId: "alba" })).rejects.toThrow("not configured");
    });

    it("exports one voice file per language and deletes them all together", async () => {
      const dir = await mkdtemp(join(tmpdir(), "voices-test-"));
      // A stand-in for the pocket-tts binary: writes a file at the output path (its last argument).
      const bin = join(dir, "fake-pocket");
      await writeFile(bin, '#!/bin/sh\nfor last; do :; done\necho "args: $*" > "$last"\n', { mode: 0o755 });
      const tts = createPocketTts({ ...cfg(), binPath: bin, voicesDir: join(dir, "voices") });
      const r = await tts.cloneVoice({ label: "x", samples: [{ name: "s.wav", mime: "audio/wav", data: wav(samples) }] });
      expect(r.languages).toEqual(["en", "hi"]);
      expect((await readdir(join(dir, "voices"))).sort()).toEqual([`${r.providerVoiceId}.hi.safetensors`, `${r.providerVoiceId}.ref.wav`, `${r.providerVoiceId}.safetensors`]); // the .ref.wav is the kept recording for Chatterbox
      await tts.deleteVoice(r.providerVoiceId);
      expect(await readdir(join(dir, "voices"))).toEqual([]);
    });

    it("makes each language's voice file from that language's own recording when one is given", async () => {
      const dir = await mkdtemp(join(tmpdir(), "voices-test-"));
      const bin = join(dir, "fake-pocket");
      // The stand-in records the size of the recording it was given into the voice file it writes.
      await writeFile(bin, '#!/bin/sh\nfor a; do last=$a; done\nfor a; do case "$a" in *.wav) in=$a;; esac; done\nwc -c < "$in" > "$last"\n', { mode: 0o755 });
      const tts = createPocketTts({ ...cfg(), binPath: bin, voicesDir: join(dir, "voices") });
      const en = wav(Array.from({ length: 1000 }, () => 100)), hi = wav(Array.from({ length: 3000 }, () => 100));
      const r = await tts.cloneVoice({ label: "x", samples: [{ name: "e.wav", mime: "audio/wav", data: en }], hindiSample: { name: "h.wav", mime: "audio/wav", data: hi } });
      const { readFile } = await import("node:fs/promises");
      expect(Number((await readFile(join(dir, "voices", `${r.providerVoiceId}.safetensors`), "utf8")).trim())).toBe(en.length);
      expect(Number((await readFile(join(dir, "voices", `${r.providerVoiceId}.hi.safetensors`), "utf8")).trim())).toBe(hi.length);
      const r2 = await tts.cloneVoice({ label: "y", samples: [{ name: "e.wav", mime: "audio/wav", data: en }] }); // no Hindi recording: English one is reused
      expect(Number((await readFile(join(dir, "voices", `${r2.providerVoiceId}.hi.safetensors`), "utf8")).trim())).toBe(en.length);
    });

    it("deleting a voice removes every file it has, even in a language that is no longer configured", async () => {
      const dir = await mkdtemp(join(tmpdir(), "voices-test-"));
      const voices = join(dir, "voices"); const { mkdir } = await import("node:fs/promises");
      await mkdir(voices, { recursive: true });
      const other = "11111111-2222-4333-8444-555555555555";
      for (const f of [`${ID}.safetensors`, `${ID}.hi.safetensors`, `${ID}.xx.safetensors`, `${other}.safetensors`, `${other}.hi.safetensors`]) await writeFile(join(voices, f), "x");
      const tts = createPocketTts({ baseUrl: "http://en", voicesDir: voices }); // no Hindi configured at all
      await tts.deleteVoice(ID);
      expect((await readdir(voices)).sort()).toEqual([`${other}.hi.safetensors`, `${other}.safetensors`]); // another person's files are untouched
    });

    it("keeps an English clone when the Hindi export fails, and can add Hindi later", async () => {
      const dir = await mkdtemp(join(tmpdir(), "voices-test-"));
      const bin = join(dir, "fake-pocket");
      await writeFile(bin, '#!/bin/sh\ncase "$*" in *hi.yaml*) echo "no hindi" >&2; exit 1;; esac\nfor last; do :; done\necho ok > "$last"\n', { mode: 0o755 });
      const tts = createPocketTts({ ...cfg(), binPath: bin, voicesDir: join(dir, "voices") });
      const r = await tts.cloneVoice({ label: "x", samples: [{ name: "s.wav", mime: "audio/wav", data: wav(samples) }] });
      expect(r.languages).toEqual(["en"]);
      expect(r.failed.map((f) => f.language)).toEqual(["hi"]);
      await expect(tts.addLanguage({ providerVoiceId: r.providerVoiceId, language: "hi", sample: { name: "s.wav", mime: "audio/wav", data: wav(samples) } })).rejects.toThrow("voice export failed");
    });
  });

  describe("Kokoro for Hindi", () => {
    const en = wav(Array.from({ length: 100 }, () => 1000)), hiAudio = wav(Array.from({ length: 100 }, () => 2000));
    function servers() {
      const calls: { kind: "pocket" | "kokoro"; text: string; voice?: string; lang?: string }[] = [];
      const f = (async (url: string, init?: RequestInit) => {
        if (String(url).startsWith("http://kokoro")) {
          const b = JSON.parse(String(init!.body)) as { text: string; voice: string; lang: string };
          calls.push({ kind: "kokoro", ...b });
          return new Response(new Uint8Array(b.lang === "hi" ? hiAudio : en), { status: 200 });
        }
        calls.push({ kind: "pocket", text: (init!.body as FormData).get("text") as string });
        return new Response(new Uint8Array(en), { status: 200 });
      }) as unknown as typeof fetch;
      return { calls, f };
    }
    const ID = "0b9c1f5e-8a5d-4d62-9a30-6c3f6a7d1e11";
    const make = (f: typeof fetch) => createPocketTts({ baseUrl: "http://en", kokoro: { baseUrl: "http://kokoro" }, voiceUrl: (id: string) => `http://files/${id}`, fetch: f });

    it("picks a Hindi voice that matches the gender", () => {
      expect(kokoroHindiVoiceFor("male")).toBe("hm_omega");
      expect(kokoroHindiVoiceFor("female")).toBe("hf_alpha");
      expect(kokoroHindiVoiceFor(undefined)).toBe("hf_alpha");
    });

    it("speaks plain English with the person's clone, not Kokoro", async () => {
      const { calls, f } = servers();
      await make(f).speak({ text: "Hello there, how are you?", voiceId: ID, hindiVoice: "hm_omega" });
      expect(calls.map((c) => c.kind)).toEqual(["pocket"]);
    });

    it("speaks a Hindi sentence wholly with the Hindi voice", async () => {
      const { calls, f } = servers();
      const r = await make(f).speak({ text: "नमस्ते, आपका स्वागत है।", voiceId: ID, hindiVoice: "hm_omega" });
      expect(calls).toEqual([{ kind: "kokoro", text: "नमस्ते, आपका स्वागत है।", voice: "hm_omega", lang: "hi" }]);
      expect(r.mime).toBe("audio/wav");
    });

    it("speaks a Hinglish sentence wholly with Kokoro: Hindi runs in the Hindi voice, English runs in the matching English voice, in order", async () => {
      const { calls, f } = servers();
      const r = await make(f).speak({ text: "जी, Kubernetes cluster की कीमत है।", voiceId: ID, hindiVoice: "hf_alpha" });
      expect(calls.every((c) => c.kind === "kokoro")).toBe(true);
      const by = (t: string) => calls.find((c) => c.text.trim().startsWith(t))!;
      expect(by("जी")).toMatchObject({ voice: "hf_alpha", lang: "hi" });
      expect(by("Kubernetes")).toMatchObject({ voice: "af_heart", lang: "en-us" });
      const pcm = new Int16Array(r.audio.buffer, r.audio.byteOffset + 44, (r.audio.length - 44) / 2);
      expect([pcm[0], pcm[100], pcm[200]]).toEqual([2000, 1000, 2000]);
      expect(kokoroHindiVoiceFor("male")).toBe("hm_omega");
    });

    it("speaks the common English words of a Hinglish sentence with Hindi sounds, so there is no American accent in the middle", async () => {
      const { calls, f } = servers();
      await make(f).speak({ text: "जी, Business plan की कीमत है।", voiceId: ID, hindiVoice: "hm_omega" });
      expect(calls).toHaveLength(1);                                   // one Hindi run, not three
      expect(calls[0]).toMatchObject({ kind: "kokoro", text: "जी, बिज़नेस प्लान की कीमत है।", voice: "hm_omega", lang: "hi" });
    });

    it("uses the male English voice with a male Hindi voice", async () => {
      const { calls, f } = servers();
      await make(f).speak({ text: "Kubernetes cluster की कीमत", voiceId: ID, hindiVoice: "hm_omega" });
      expect(calls.find((c) => c.lang === "en-us")!.voice).toBe("am_michael");
    });

    it("reports a failing Hindi voice clearly", async () => {
      const f = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
      await expect(make(f).speak({ text: "नमस्ते", voiceId: ID })).rejects.toThrow(/Hindi voice failed: 500/);
    });
  });

  describe("voice conversion for Hindi", () => {
    const ID = "0b9c1f5e-8a5d-4d62-9a30-6c3f6a7d1e11";
    const kokoroAudio = wav(Array.from({ length: 100 }, () => 2000)), convertedAudio = wav(Array.from({ length: 150 }, () => 7000));
    const pcmOf = (a: Uint8Array) => new Int16Array(a.buffer, a.byteOffset + 44, (a.length - 44) / 2);

    function world(convert: (url: string, init: RequestInit) => Response | Promise<Response>) {
      const calls: { url: string; body?: BodyInit | null }[] = [];
      const f = (async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), body: init?.body });
        if (String(url).startsWith("http://kokoro")) return new Response(new Uint8Array(kokoroAudio), { status: 200 });
        if (String(url).startsWith("http://convert")) return convert(String(url), init!);
        return new Response(new Uint8Array(kokoroAudio), { status: 200 });
      }) as unknown as typeof fetch;
      return { calls, f };
    }
    const make = (f: typeof fetch, extra = {}) => createPocketTts({ baseUrl: "http://en", kokoro: { baseUrl: "http://kokoro" }, convert: { baseUrl: "http://convert" }, voiceUrl: (id: string) => `http://files/${id}.safetensors`, fetch: f, ...extra });

    it("changes a Hindi sentence to the person's own voice", async () => {
      const { calls, f } = world(() => new Response(new Uint8Array(convertedAudio), { status: 200 }));
      const r = await make(f).speak({ text: "नमस्ते, आपका स्वागत है।", voiceId: ID, hindiVoice: "hm_omega" });
      expect(r.hindiVoice).toBe("converted");
      expect(pcmOf(r.audio)).toHaveLength(150);
      expect(pcmOf(r.audio)[0]).toBe(7000);
      const sent = calls.find((c) => c.url.startsWith("http://convert"))!;
      expect(sent.url).toBe(`http://convert/convert?id=${ID}`);
      expect(pcmOf(sent.body as Uint8Array)[0]).toBe(2000); // Kokoro's speech is what was sent to be converted
    });

    it("sends a whole mixed sentence to be converted once, so it has one voice", async () => {
      const { calls, f } = world(() => new Response(new Uint8Array(convertedAudio), { status: 200 }));
      await make(f).speak({ text: "जी, Kubernetes cluster की कीमत है।", voiceId: ID, hindiVoice: "hf_alpha" });
      expect(calls.filter((c) => c.url.startsWith("http://convert"))).toHaveLength(1);
      expect(pcmOf(calls.find((c) => c.url.startsWith("http://convert"))!.body as Uint8Array)).toHaveLength(300); // three runs joined
    });

    it("leaves plain English to the clone, with no conversion", async () => {
      const { calls, f } = world(() => new Response("no", { status: 500 }));
      const r = await make(f).speak({ text: "Hello there", voiceId: ID, hindiVoice: "hm_omega" });
      expect(calls.some((c) => c.url.startsWith("http://convert"))).toBe(false);
      expect(r.hindiVoice).toBeUndefined();
    });

    it("falls back to the built-in Hindi voice, and says so, when the voice has no fingerprint", async () => {
      const { f } = world(() => new Response("this voice has no fingerprint", { status: 404 }));
      const why: string[] = [];
      const r = await make(f, { onNotConverted: (_id: string, w: string) => why.push(w) }).speak({ text: "नमस्ते", voiceId: ID, hindiVoice: "hm_omega" });
      expect(r.hindiVoice).toBe("built-in");
      expect(pcmOf(r.audio)[0]).toBe(2000);
      expect(why).toEqual(["no_fingerprint"]);
    });

    it("falls back instead of failing when the conversion server is down", async () => {
      const { f } = world(() => { throw new TypeError("fetch failed"); });
      const why: string[] = [];
      const r = await make(f, { onNotConverted: (_id: string, w: string) => why.push(w) }).speak({ text: "नमस्ते", voiceId: ID, hindiVoice: "hm_omega" });
      expect(r.hindiVoice).toBe("built-in");
      expect(why).toEqual(["unavailable"]);
    });

    it("does not swallow a cancellation (an interrupted caller)", async () => {
      const ac = new AbortController();
      const { f } = world(() => { ac.abort(); throw new DOMException("aborted", "AbortError"); });
      await expect(make(f).speak({ text: "नमस्ते", voiceId: ID, hindiVoice: "hm_omega", signal: ac.signal })).rejects.toThrow();
    });

    it("makes a voice fingerprint from the recording when cloning, and reports whether Hindi will be in the person's voice", async () => {
      const dir = await mkdtemp(join(tmpdir(), "voices-test-"));
      const bin = join(dir, "fake-pocket");
      await writeFile(bin, '#!/bin/sh\nfor last; do :; done\necho ok > "$last"\n', { mode: 0o755 });
      const embedded: { url: string; size: number }[] = [];
      const f = (async (url: string, init?: RequestInit) => { embedded.push({ url: String(url), size: (init!.body as Uint8Array).length }); return new Response("ok", { status: 200 }); }) as unknown as typeof fetch;
      const tts = createPocketTts({ baseUrl: "http://en", binPath: bin, voicesDir: join(dir, "voices"), convert: { baseUrl: "http://convert" }, fetch: f });
      const rec = wav(Array.from({ length: 1000 }, () => 100));
      const r = await tts.cloneVoice({ label: "x", samples: [{ name: "a.wav", mime: "audio/wav", data: rec }] });
      expect(r.hindiInOwnVoice).toBe(true);
      expect(embedded).toEqual([{ url: `http://convert/embed?id=${r.providerVoiceId}`, size: rec.length }]);

      const broken = createPocketTts({ baseUrl: "http://en", binPath: bin, voicesDir: join(dir, "voices"), convert: { baseUrl: "http://convert" }, fetch: (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch });
      const r2 = await broken.cloneVoice({ label: "y", samples: [{ name: "a.wav", mime: "audio/wav", data: rec }] });
      expect(r2.languages).toContain("en"); // English still works
      expect(r2.hindiInOwnVoice).toBe(false);
      expect(r2.failed.some((x) => /fingerprint/.test(x.reason))).toBe(true);
    });

    it("adding Hindi to an existing voice makes its fingerprint", async () => {
      const embedded: string[] = [];
      const f = (async (url: string) => { embedded.push(String(url)); return new Response("ok", { status: 200 }); }) as unknown as typeof fetch;
      const tts = createPocketTts({ baseUrl: "http://en", convert: { baseUrl: "http://convert" }, fetch: f });
      await tts.addLanguage({ providerVoiceId: ID, language: "hi", sample: { name: "a.wav", mime: "audio/wav", data: wav(Array.from({ length: 1000 }, () => 100)) } });
      expect(embedded).toEqual([`http://convert/embed?id=${ID}`]);
    });

    it("deleting a voice also deletes its fingerprint", async () => {
      const dir = await mkdtemp(join(tmpdir(), "voices-test-"));
      const voices = join(dir, "voices"); const { mkdir } = await import("node:fs/promises");
      await mkdir(voices, { recursive: true });
      for (const n of [`${ID}.safetensors`, `${ID}.se.pt`, `${ID}.hi.safetensors`]) await writeFile(join(voices, n), "x");
      await writeFile(join(voices, "11111111-2222-4333-8444-555555555555.se.pt"), "x");
      await createPocketTts({ baseUrl: "http://en", voicesDir: voices }).deleteVoice(ID);
      expect(await readdir(voices)).toEqual(["11111111-2222-4333-8444-555555555555.se.pt"]);
    });
  });
});
