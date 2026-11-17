import { describe, expect, it } from "vitest";
import { nextBestHourAt } from "./scheduling";

describe("nextBestHourAt", () => {
  it("picks the upcoming India-time hour when there is enough lead time", () => {
    expect(nextBestHourAt(10, new Date("2026-01-01T03:30:00.000Z")).toISOString())
      .toBe("2026-01-01T04:30:00.000Z");
  });

  it("moves to the next day when today's best hour has passed or is too close", () => {
    expect(nextBestHourAt(10, new Date("2026-01-01T04:55:00.000Z")).toISOString())
      .toBe("2026-01-02T04:30:00.000Z");
  });

  it("rejects hours outside the campaign calling window", () => {
    expect(() => nextBestHourAt(21)).toThrow(RangeError);
  });
});
