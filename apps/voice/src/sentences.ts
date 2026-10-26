/**
 * Cuts a streamed reply into speakable pieces as it arrives, so the first sentence can be spoken while the model is
 * still writing the rest. Splits on . ! ? and the Hindi danda. The first piece may also end at a comma once it is
 * long enough, because the first sound is what the caller waits for.
 */
export class SentenceChunker {
  private buf = "";
  private emitted = 0;

  constructor(private readonly opts: { minChars?: number; firstMinChars?: number; eagerFirstChars?: number } = {}) {}

  push(token: string): string[] {
    this.buf += token;
    const out: string[] = [];
    for (;;) {
      // The first piece may be a short opener like "Sure.": it is what the caller waits for.
      const min = this.emitted === 0 ? (this.opts.firstMinChars ?? 4) : (this.opts.minChars ?? 12);
      const cut = this.findCut(min);
      if (cut < 0) break;
      const piece = this.buf.slice(0, cut).trim();
      this.buf = this.buf.slice(cut);
      if (piece) { out.push(piece); this.emitted++; }
    }
    return out;
  }

  flush(): string | null {
    const rest = this.buf.trim();
    this.buf = "";
    if (!rest) return null;
    this.emitted++;
    return rest;
  }

  private findCut(min: number): number {
    const eager = this.emitted === 0 ? (this.opts.eagerFirstChars ?? 40) : Infinity;
    for (let i = 0; i < this.buf.length; i++) {
      const c = this.buf[i]!;
      const next = this.buf[i + 1];
      const endsSentence = ".!?।".includes(c) && (next === undefined ? false : /\s/.test(next));
      // A decimal point or an abbreviation like "Dr." is not a sentence end: require enough text before the cut.
      if (endsSentence && i + 1 >= min) return i + 1;
      if (c === "," && i + 1 >= eager && next !== undefined && /\s/.test(next)) return i + 1;
    }
    return -1;
  }
}
