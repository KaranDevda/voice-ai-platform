import { describe, expect, it } from "vitest";
import { MAX_AUDIO_BYTES, sniffAudio } from "./campaigns";
import { textArray } from "./sql-array";
import { PgDialect } from "drizzle-orm/pg-core";

const bytes = (head: number[], n = 2000) => { const b = new Uint8Array(n); b.set(head, 0); return b; };
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

describe("sniffAudio", () => {
  it("recognises a WAV by its RIFF/WAVE header", () => { const b = bytes(ascii("RIFF")); b.set(ascii("WAVE"), 8); expect(sniffAudio(b)).toBe("audio/wav"); });
  it("recognises an MP3 by an ID3 tag or a frame sync", () => { expect(sniffAudio(bytes(ascii("ID3")))).toBe("audio/mpeg"); expect(sniffAudio(bytes([0xff, 0xfb]))).toBe("audio/mpeg"); });
  it("refuses anything else, whatever it is called", () => {
    expect(sniffAudio(new TextEncoder().encode("MZ this is a program, renamed song.mp3"))).toBeNull();
    expect(sniffAudio(bytes(ascii("RIFF")))).toBeNull(); // a RIFF file that is not WAVE (for example AVI)
    expect(sniffAudio(new Uint8Array(0))).toBeNull();
  });
  it("has a 5 MB limit", () => { expect(MAX_AUDIO_BYTES).toBe(5 * 1024 * 1024); });
});

describe("textArray", () => {
  const dialect = new PgDialect();
  it("builds ARRAY[...]::text[] with one bound value per item", () => {
    const q = dialect.sqlToQuery(textArray(["smb", "vip"]));
    expect(q.sql).toBe("ARRAY[$1, $2]::text[]"); expect(q.params).toEqual(["smb", "vip"]);
  });
});
