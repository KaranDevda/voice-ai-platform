import { describe, expect, it } from "vitest";
import { parseRates } from "./rate-import";

describe("price list import", () => {
  it("reads countries and prices in paise", () => {
    const r = parseRates("country,call_per_min_paise,sms_paise\nin,150,25\nUS;400;90\n");
    expect(r.rows).toEqual([{ country: "IN", callPerMinPaise: 150, smsPaise: 25 }]);
    expect(r.problems).toHaveLength(1); // "US;400;90" is one cell in a comma file: its price columns are missing
  });
  it("reports bad rows by row number and keeps the good ones", () => {
    const r = parseRates("country,call,sms\nIN,150,25\nINDIA,1,1\nIN,2,2\nAE,abc,5\nAE,-1,5\nGB,300,60\n");
    expect(r.rows.map((x) => x.country)).toEqual(["IN", "GB"]);
    expect(r.problems.map((p) => p.row)).toEqual([3, 4, 5, 6]);
  });
  it("needs the column names", () => {
    expect(() => parseRates("IN,150,25\n")).toThrow(/column names/);
    expect(() => parseRates("")).toThrow(/empty/);
  });
});
