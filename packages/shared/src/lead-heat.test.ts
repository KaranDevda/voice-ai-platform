import { describe, expect, it } from "vitest";
import { heatOf, heatRange } from "./lead-heat";

describe("lead heat", () => {
  it("draws the lines at 70 and 40", () => {
    expect([100, 70, 69, 40, 39, 0].map(heatOf)).toEqual(["hot", "hot", "warm", "warm", "cold", "cold"]);
    expect(heatOf(null)).toBeNull();
  });
  it("ranges match the lines, with no gap and no overlap", () => {
    expect(heatRange("hot")).toEqual([70, 100]); expect(heatRange("warm")).toEqual([40, 69]); expect(heatRange("cold")).toEqual([0, 39]);
  });
});
