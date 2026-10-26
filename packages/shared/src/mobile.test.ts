import { describe, expect, it } from "vitest";
import { formatPairingCode, normalizePairingCode, splitSyncBatch } from "./mobile";

describe("splitSyncBatch", () => {
  const good = { localId: "a", number: "+919800000001", direction: "outbound", status: "connected", startedAt: "2026-10-26T04:30:00Z", durationS: 5 };
  it("keeps good calls and answers for bad ones in their original places", () => {
    const { valid, invalid } = splitSyncBatch([good, { localId: "b", number: "x" }, null, { ...good, localId: "c", direction: "sideways" }, { ...good, localId: "d", number: "" }]);
    expect(valid.map((v) => `${v.at}:${v.call.localId}`)).toEqual(["0:a", "4:d"]); // an empty number is valid input; the server refuses it as a number
    expect(invalid.map((v) => `${v.at}:${v.outcome.localId}:${v.outcome.reason}`)).toEqual(["1:b:invalid_call", "2:#2:invalid_call", "3:c:invalid_call"]);
  });
});

describe("pairing codes", () => {
  it("accepts what a person types", () => {
    expect(normalizePairingCode(" ab12-cd34 ")).toBe("AB12CD34");
    expect(formatPairingCode("ABCD2345")).toBe("ABCD-2345");
  });
});
