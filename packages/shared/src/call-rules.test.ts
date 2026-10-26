import { describe, expect, it } from "vitest";
import { callBlockReason, inCallingWindow, istMinutes } from "./call-rules";

const W = { windowStart: "09:00", windowEnd: "21:00" };
const ok = { dndFlag: false, consentStatus: "granted" as const };
// 2026-10-26 in UTC; India is UTC+5:30 with no daylight saving.
const at = (utc: string) => new Date(`2026-10-26T${utc}:00Z`);

describe("calling hours (India time)", () => {
  it("converts to IST whatever the server's time zone is", () => {
    expect(istMinutes(at("00:00"))).toBe(5 * 60 + 30);
    expect(istMinutes(at("18:29"))).toBe(23 * 60 + 59);
    expect(istMinutes(at("18:30"))).toBe(0); // midnight IST
  });
  it("allows 9:00 to just before 21:00 and nothing outside", () => {
    expect(inCallingWindow(at("03:29"), W)).toBe(false); // 08:59 IST
    expect(inCallingWindow(at("03:30"), W)).toBe(true);  // 09:00 IST
    expect(inCallingWindow(at("15:29"), W)).toBe(true);  // 20:59 IST
    expect(inCallingWindow(at("15:30"), W)).toBe(false); // 21:00 IST
    expect(inCallingWindow(at("20:00"), W)).toBe(false); // 01:30 IST
  });
  it("uses the organisation's own window", () => {
    expect(inCallingWindow(at("12:30"), { windowStart: "10:00", windowEnd: "18:00" })).toBe(false); // 18:00 IST
    expect(inCallingWindow(at("12:29"), { windowStart: "10:00", windowEnd: "18:00" })).toBe(true);
  });
});

describe("callBlockReason", () => {
  const noon = at("06:30"); // 12:00 IST
  it("lets a normal call through", () => expect(callBlockReason(ok, W, noon)).toBeNull());
  it("blocks Do Not Disturb first, even inside the window", () => expect(callBlockReason({ ...ok, dndFlag: true }, W, noon)).toBe("dnd"));
  it("blocks withdrawn and denied consent, but not unknown or granted", () => {
    expect(callBlockReason({ ...ok, consentStatus: "withdrawn" }, W, noon)).toBe("consent_withdrawn");
    expect(callBlockReason({ ...ok, consentStatus: "denied" }, W, noon)).toBe("consent_denied");
    expect(callBlockReason({ ...ok, consentStatus: "unknown" }, W, noon)).toBeNull();
  });
  it("blocks outside the hours", () => expect(callBlockReason(ok, W, at("20:00"))).toBe("outside_hours"));
  it("reports DND even when it is also outside the hours", () => expect(callBlockReason({ ...ok, dndFlag: true }, W, at("20:00"))).toBe("dnd"));
});
