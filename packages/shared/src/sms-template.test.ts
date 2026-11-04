import { describe, expect, it } from "vitest";
import { renderTemplate, templateVariables } from "./sms-template";

describe("text templates", () => {
  it("fills the name, first name and custom columns", () => {
    expect(renderTemplate("Hi {{first_name}}, {{city}} offer for {{name}}", { name: "Asha Rao", fields: { city: "Pune" } })).toBe("Hi Asha, Pune offer for Asha Rao");
  });
  it("uses the fallback when there is no value, and never leaves raw braces", () => {
    expect(renderTemplate("Hi {{name|there}}!", { name: null })).toBe("Hi there!");
    expect(renderTemplate("Hi {{name}}, welcome {{unknown}}", { name: null })).toBe("Hi, welcome");
  });
  it("understands column names with spaces and capitals", () => {
    expect(renderTemplate("{{Plan Name}}", { fields: { plan_name: "Gold" } })).toBe("Gold");
  });
  it("lists the words a template needs", () => { expect(templateVariables("{{name|x}} {{City}} {{name}}")).toEqual(["name", "city"]); });
});
