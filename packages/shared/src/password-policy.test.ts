import { describe, expect, it } from "vitest";
import { passwordProblem } from "./password-policy";

describe("passwordProblem", () => {
  it("accepts a long passphrase", () => { expect(passwordProblem("correct horse battery staple", "a@b.com")).toBeNull(); });
  it("refuses short, huge, repeated and e-mail-based passwords", () => {
    expect(passwordProblem("short")).toMatch(/12/);
    expect(passwordProblem("x".repeat(201))).toMatch(/200/);
    expect(passwordProblem("aaaaaaaaaaaaaaaa")).not.toBeNull();
    expect(passwordProblem("abababababababab")).not.toBeNull();
    expect(passwordProblem("karan.devda@example.com", "karan.devda@example.com")).toMatch(/e-mail/);
    expect(passwordProblem("my-karan.devda-password", "karan.devda@example.com")).toMatch(/e-mail/);
  });
  it("does not insist on special characters", () => { expect(passwordProblem("lowercase words only here", "u@x.io")).toBeNull(); });
});
