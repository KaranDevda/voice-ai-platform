import { describe, expect, it } from "vitest";
import { sendEmail, smtpFromEnv, smtpSummary } from "./email";

describe("SMTP settings", () => {
  it("is off until the host and the sender are set", () => {
    expect(smtpFromEnv({})).toBeNull();
    expect(smtpFromEnv({ SMTP_HOST: "mail.example.com" })).toBeNull();
  });
  it("reads the settings, defaulting to port 587 and using TLS on 465", () => {
    expect(smtpFromEnv({ SMTP_HOST: "m.example.com", SMTP_FROM: "a@example.com" })).toMatchObject({ port: 587, secure: false });
    expect(smtpFromEnv({ SMTP_HOST: "m.example.com", SMTP_FROM: "a@example.com", SMTP_PORT: "465" })).toMatchObject({ port: 465, secure: true });
  });
  it("never shows the password", () => {
    const s = smtpSummary(smtpFromEnv({ SMTP_HOST: "m.example.com", SMTP_FROM: "a@example.com", SMTP_USER: "u", SMTP_PASS: "secret" }));
    expect(JSON.stringify(s)).not.toContain("secret");
    expect(smtpSummary(null)).toEqual({ configured: false });
  });
  it("refuses a bad address before connecting", async () => {
    const cfg = smtpFromEnv({ SMTP_HOST: "127.0.0.1", SMTP_FROM: "a@example.com" })!;
    await expect(sendEmail(cfg, { to: "not an address", subject: "x", text: "y" })).rejects.toThrow(/looks wrong/);
  });
});
