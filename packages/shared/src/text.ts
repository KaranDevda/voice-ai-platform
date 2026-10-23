/**
 * Splits text into overlapping chunks for the knowledge base, preferring paragraph then sentence
 * boundaries so an answer is never cut mid-sentence when it can be avoided.
 */
export function chunkText(text: string, size = 800, overlap = 100): string[] {
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const para = window.lastIndexOf("\n\n");
      const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
      const cut = para > size * 0.4 ? para : sentence > size * 0.4 ? sentence + 1 : -1;
      if (cut > 0) end = start + cut;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

/** Lowercase search terms of 3+ letters, deduplicated, for keyword retrieval. */
export function searchTerms(query: string, max = 8): string[] {
  const stop = new Set(["the", "and", "for", "are", "you", "with", "this", "that", "what", "how", "can", "does", "your", "have", "from", "about", "will"]);
  return [...new Set(query.toLowerCase().split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w.length >= 3 && !stop.has(w)))].slice(0, max);
}
