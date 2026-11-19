import { describe, expect, it } from "vitest";
import { hashRecoveryCode, newRecoveryCodes, parseRecoveryHashes, RECOVERY_CODE_COUNT } from "./mfa-codes";

describe("recovery codes", () => {
  it("makes distinct codes that hash the same however they are typed", () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(RECOVERY_CODE_COUNT);
    expect(new Set(codes).size).toBe(RECOVERY_CODE_COUNT);
    const c = codes[0]!;
    expect(hashRecoveryCode(c)).toBe(hashRecoveryCode(c.toUpperCase().replace("-", " ")));
    expect(hashRecoveryCode(c)).not.toBe(hashRecoveryCode(codes[1]!));
  });
  it("tolerates missing or broken stored data", () => {
    expect(parseRecoveryHashes(null)).toEqual([]);
    expect(parseRecoveryHashes("not json")).toEqual([]);
    expect(parseRecoveryHashes('["a",1]')).toEqual(["a"]);
  });
});
