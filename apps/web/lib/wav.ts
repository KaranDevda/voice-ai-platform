/** Browser-side: decodes recordings (webm, mp3, m4a, wav...), joins them and returns one mono 16-bit WAV. */
export async function samplesToWav(files: File[], opts: { sampleRate?: number; maxSeconds?: number } = {}): Promise<File> {
  const rate = opts.sampleRate ?? 24_000;
  const maxSamples = Math.floor((opts.maxSeconds ?? 30) * rate);
  const ctx = new AudioContext();
  const parts: Float32Array[] = [];
  let total = 0;
  try {
    for (const f of files) {
      if (total >= maxSamples) break;
      const decoded = await ctx.decodeAudioData(await f.arrayBuffer());
      // Resample and mix down to mono by rendering through an offline context at the target rate.
      const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
      const src = off.createBufferSource();
      src.buffer = decoded;
      src.connect(off.destination);
      src.start();
      const data = (await off.startRendering()).getChannelData(0);
      const take = Math.min(data.length, maxSamples - total);
      parts.push(data.subarray(0, take));
      total += take;
    }
  } finally {
    void ctx.close();
  }
  if (!total) throw new Error("The recording could not be read. Try recording again.");
  const pcm = new Int16Array(total);
  let o = 0;
  for (const p of parts) for (let i = 0; i < p.length; i++) pcm[o++] = Math.max(-1, Math.min(1, p[i]!)) * 0x7fff;
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const w = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new File([buf], "voice-sample.wav", { type: "audio/wav" });
}

/** Length of an audio file in milliseconds, read from its header; null if the browser cannot tell. */
export function audioDurationMs(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const done = (ms: number | null) => { URL.revokeObjectURL(url); resolve(ms); };
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) && a.duration > 0 ? Math.round(a.duration * 1000) : null);
    a.onerror = () => done(null);
    setTimeout(() => done(null), 4000);
    a.src = url;
  });
}
