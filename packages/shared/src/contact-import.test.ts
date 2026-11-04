import { describe, expect, it } from "vitest";
import { parseContacts, parseCsv, splitTags } from "./contact-import";

describe("contact import", () => {
  it("reads quoted cells, commas and line breaks inside quotes", () => {
    expect(parseCsv('a,b\n"x, y","line1\nline2"\n')).toEqual([["a", "b"], ["x, y", "line1\nline2"]]);
  });
  it("cleans phones, drops duplicates and bad numbers, keeps tags and extra columns", () => {
    const r = parseContacts("Name,Mobile,Email,Tags,City\nAsha,98765 43210,asha@x.in,VIP; diwali,Pune\nAsha again,+919876543210,,,\nBad,12,,,\n", ["Leads"]);
    expect(r.contacts).toHaveLength(1);
    expect(r.contacts[0]).toMatchObject({ name: "Asha", phone: "+919876543210", email: "asha@x.in", tags: ["leads", "vip", "diwali"], fields: { city: "Pune" } });
    expect(r.duplicates).toBe(1);
    expect(r.problems).toEqual([{ row: 4, reason: 'not a valid phone number: "12"' }]);
  });
  it("needs a phone column and a header row", () => {
    expect(() => parseContacts("Asha,9876543210\n")).toThrow(/phone/);
    expect(() => parseContacts("")).toThrow(/empty/);
  });
  it("understands Hindi headers", () => {
    expect(parseContacts("नाम,मोबाइल\nआशा,9876543210\n").contacts[0]).toMatchObject({ name: "आशा", phone: "+919876543210" });
  });
  it("tags are lower-case, trimmed and unique", () => { expect(splitTags(" VIP , vip,Diwali ")).toEqual(["vip", "diwali"]); });
});
