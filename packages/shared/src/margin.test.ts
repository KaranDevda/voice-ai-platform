import { describe, expect, it } from "vitest";
import { marginOfRevenuePct, priceWithMargin } from "./margin";

describe("priceWithMargin", () => {
  it("adds the margin on top of the cost", () => { expect(priceWithMargin(100, 25)).toBe(125); expect(priceWithMargin(200, 0)).toBe(200); });
  it("rounds up to a whole paise", () => { expect(priceWithMargin(33, 10)).toBe(37); expect(priceWithMargin(1, 1)).toBe(2); });
  it("keeps a zero cost at zero", () => expect(priceWithMargin(0, 50)).toBe(0));
  it("rejects bad input", () => {
    expect(() => priceWithMargin(-1, 10)).toThrow(RangeError);
    expect(() => priceWithMargin(100, -5)).toThrow(RangeError);
    expect(() => priceWithMargin(100, 5000)).toThrow(RangeError);
    expect(() => priceWithMargin(NaN, 10)).toThrow(RangeError);
  });
});
describe("marginOfRevenuePct", () => {
  it("is profit over revenue", () => expect(marginOfRevenuePct(125, 100)).toBe(20));
  it("is 0 with no revenue", () => expect(marginOfRevenuePct(0, 100)).toBe(0));
});
