import { describe, expect, it } from "vitest";
import { maskPhone, normalizePhone } from "./phone";

describe("phone", () => {
  it("normalises Indian numbers to E.164", () => {
    expect(normalizePhone("98765 43210")).toBe("+919876543210");
    expect(normalizePhone("+91 98765 43210")).toBe("+919876543210");
  });

  it("rejects invalid numbers", () => {
    expect(normalizePhone("12345")).toBeNull();
  });

  it("masks to the SOP format", () => {
    expect(maskPhone("+919876543123")).toBe("98XXXXX123");
  });
});
