/** Reading a price list (CSV) for a bulk import: country, call price per minute and text price, all in paise (100 paise = Rs 1). */
export interface RateRow { country: string; callPerMinPaise: number; smsPaise: number }
export interface RateProblem { row: number; reason: string }
export const MAX_RATE_ROWS = 300;

const split = (line: string, sep: string) => { const out: string[] = []; let cell = "", q = false; for (let i = 0; i < line.length; i++) { const c = line[i]!; if (q) { if (c === '"') { if (line[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; } else if (c === '"' && cell === "") q = true; else if (c === sep) { out.push(cell); cell = ""; } else cell += c; } out.push(cell); return out.map((x) => x.trim()); };

export function parseRates(text: string): { rows: RateRow[]; problems: RateProblem[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) throw new RangeError("the file is empty");
  const sep = [",", ";", "\t"].map((c) => [c, lines[0]!.split(c).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const head = split(lines[0]!, sep).map((h) => h.toLowerCase().replace(/[\s-]+/g, "_"));
  const find = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const ci = find("country", "country_code", "iso"), cc = find("call_per_min_paise", "call_paise", "call", "call_per_minute"), si = find("sms_paise", "sms", "text", "text_paise");
  if (ci < 0 || cc < 0 || si < 0) throw new RangeError('the first row must name the columns: country, call_per_min_paise, sms_paise');
  if (lines.length - 1 > MAX_RATE_ROWS) throw new RangeError(`at most ${MAX_RATE_ROWS} countries at a time`);
  const rows: RateRow[] = [], problems: RateProblem[] = [], seen = new Set<string>();
  lines.slice(1).forEach((line, i) => {
    const cells = split(line, sep), n = i + 2;
    const country = (cells[ci] ?? "").toUpperCase();
    if (!/^[A-Z]{2}$/.test(country)) return void problems.push({ row: n, reason: `the country must be a 2-letter code like IN, not "${(cells[ci] ?? "").slice(0, 20)}"` });
    if (seen.has(country)) return void problems.push({ row: n, reason: `${country} appears twice` });
    const num = (v: string | undefined) => (v !== undefined && /^\d{1,6}$/.test(v) ? Number(v) : null);
    const call = num(cells[cc]), sms = num(cells[si]);
    if (call === null || sms === null || call > 100_000 || sms > 100_000) return void problems.push({ row: n, reason: "prices must be whole numbers of paise, 0 to 100000" });
    seen.add(country);
    rows.push({ country, callPerMinPaise: call, smsPaise: sms });
  });
  return { rows, problems };
}
