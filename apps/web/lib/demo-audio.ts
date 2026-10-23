/** Dev-only placeholder audio: a short 8 kHz WAV of soft beeps, so the player and audit trail can be exercised without S3. */
export function demoWav(seconds: number): Uint8Array {
  const rate = 8000;
  const n = Math.round(Math.min(Math.max(seconds, 2), 12) * rate);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const burst = Math.max(0, Math.sin(t * Math.PI * 1.6)); // slow on/off envelope, like phrases
    const f = 280 + 140 * Math.sin(t * 2.3);
    v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * f * t) * burst * 5000), true);
  }
  return new Uint8Array(buf);
}
