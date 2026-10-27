import { mulawToPcm16 } from "@voiceai/providers";

/**
 * Phone audio arrives as 8 kHz µ-law, but speech recognition wants 16 kHz 16-bit. Decodes a chunk and doubles its sample rate by
 * putting the average of two neighbouring samples between them. It keeps the last sample between chunks, so chunk boundaries have no clicks.
 */
export class MulawTo16k {
  private prev = 0;
  convert(frame: Uint8Array): Uint8Array {
    const s = mulawToPcm16(frame);
    const out = new Int16Array(s.length * 2);
    for (let i = 0; i < s.length; i++) {
      out[2 * i] = (this.prev + s[i]!) >> 1;
      out[2 * i + 1] = s[i]!;
      this.prev = s[i]!;
    }
    return new Uint8Array(out.buffer);
  }
}
