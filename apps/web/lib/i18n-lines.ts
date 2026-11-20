/**
 * Reads a block of translations: one line per text, `English => es | fr | ar | zh | hi | pt | ru | ja | de` (the order of lib/i18n.ts).
 * A `{name}` in a text is a value filled in at display time and must appear in every translation.
 */
export function parseLines(block: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of block.trim().split("\n")) {
    const i = line.indexOf(" => ");
    if (i < 0) continue;
    out[line.slice(0, i)] = line.slice(i + 4).split("|").map((s) => s.trim());
  }
  return out;
}
