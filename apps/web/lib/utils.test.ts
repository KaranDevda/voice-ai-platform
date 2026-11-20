import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatNumber, formatTime, localeOf, timeAgo } from "./utils";

const d = "2026-11-19T06:47:00Z"; // 12:17 pm in India

describe("dates and numbers follow the interface language", () => {
  it("keeps English as it was", () => {
    expect(formatDateTime(d)).toBe("19 Nov, 12:17 pm");
    expect(formatDate(d)).toBe("19 Nov 2026");
  });
  it("formats the month and clock the way each language does", () => {
    expect(formatDateTime(d, "fr")).not.toBe(formatDateTime(d, "en"));
    expect(formatDateTime(d, "fr")).toMatch(/nov/i);
    expect(formatDateTime(d, "de")).toMatch(/Nov/);
    expect(formatDateTime(d, "ja")).toContain("11月");
    expect(formatDate(d, "zh")).toContain("2026");
    expect(formatDateTime(d, "ar")).not.toMatch(/Nov/);
    expect(formatTime(d, "fr")).toContain("12:17");
  });
  it("groups digits per language and falls back to English for an unknown code", () => {
    expect(formatNumber(1234567, "en")).toBe("12,34,567");
    expect(formatNumber(1234567, "de")).toBe("1.234.567");
    expect(localeOf("not-a-language-xx-yy")).toBe("en-IN");
    expect(formatDate(d, "zz")).toBe(formatDate(d, "en"));
  });
  it("says how long ago in the language", () => {
    const now = Date.parse(d);
    expect(timeAgo(new Date(now - 5 * 60_000), now)).toBe("5m ago");
    expect(timeAgo(new Date(now - 5 * 60_000), now, "fr")).not.toBe("5m ago");
    expect(timeAgo(new Date(now - 5 * 60_000), now, "fr")).toMatch(/5/);
  });
});
