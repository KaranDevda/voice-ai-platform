// Runs on the audio thread. Collects microphone samples into 20 ms blocks of 16-bit PCM and posts them to the page.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Int16Array(Math.round(sampleRate * 0.02));
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const s = Math.max(-1, Math.min(1, ch[i]));
      this.block[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.n === this.block.length) {
        this.port.postMessage(this.block.slice().buffer, []);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
