import { describe, expect, it } from "vitest";
import { checkGstin, checkPan, gstinCheckChar, sniffDocument } from "./kyc-checks";

describe("PAN", () => {
  it("accepts a well-formed PAN and refuses a wrong shape or holder letter", () => {
    expect(checkPan("ABCPE1234F")).toBeNull();
    expect(checkPan("ABCDE1234")).toContain("looks wrong");
    expect(checkPan("ABCXE1234F")).toContain("4th letter");
  });
});

describe("GSTIN", () => {
  it("computes the check character (known valid GSTIN 27AAPFU0939F1ZV)", () => {
    expect(gstinCheckChar("27AAPFU0939F1Z")).toBe("V");
    expect(checkGstin("27AAPFU0939F1ZV")).toBeNull();
  });
  it("refuses a typing mistake, a wrong state code and a bad shape", () => {
    expect(checkGstin("27AAPFU0939F1ZX")).toContain("does not match");
    expect(checkGstin("50AAPFU0939F1ZV")).toContain("state code");
    expect(checkGstin("27AAPFU0939F1Y")).toContain("looks wrong");
  });
  it("requires the GSTIN to carry the same PAN", () => {
    expect(checkGstin("27AAPFU0939F1ZV", "AAPFU0939F")).toBeNull();
    expect(checkGstin("27AAPFU0939F1ZV", "ABCDE1234F")).toContain("does not belong");
  });
});

describe("document sniffing", () => {
  it("recognises PDF, PNG and JPEG by their first bytes and nothing else", () => {
    expect(sniffDocument(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))?.mime).toBe("application/pdf");
    expect(sniffDocument(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime).toBe("image/png");
    expect(sniffDocument(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe("image/jpeg");
    expect(sniffDocument(new TextEncoder().encode("<script>alert(1)</script>"))).toBeNull();
  });
});
