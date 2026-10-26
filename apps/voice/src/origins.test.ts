import { describe, expect, it } from "vitest";
import { allowedOrigins, originAllowed } from "./origins";

describe("voice stream origins", () => {
  it("accepts the web app on either local port, by name or by address", () => {
    const a = allowedOrigins(undefined);
    for (const o of ["http://localhost:3000", "http://localhost:3001", "http://127.0.0.1:3000", "http://127.0.0.1:3001"]) expect(originAllowed(o, a)).toBe(true);
  });
  it("refuses other sites and other ports", () => {
    const a = allowedOrigins(undefined);
    for (const o of ["https://evil.example", "http://localhost:3002", "http://localhost.evil.example:3000", "http://localhost:30001"]) expect(originAllowed(o, a)).toBe(false);
  });
  it("lets non-browser clients through, since the signed token still has to check out", () => {
    expect(originAllowed(undefined, allowedOrigins(undefined))).toBe(true);
  });
  it("uses the configured list in production", () => {
    const a = allowedOrigins("https://app.bizfy.example/, https://admin.bizfy.example");
    expect(originAllowed("https://app.bizfy.example", a)).toBe(true);
    expect(originAllowed("https://admin.bizfy.example", a)).toBe(true);
    expect(originAllowed("http://localhost:3000", a)).toBe(false);
  });
});
