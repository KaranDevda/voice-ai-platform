import nodemailer from "nodemailer";
import { ProviderError } from "./types";

/** Outgoing e-mail through the platform's own SMTP server. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM (SMTP_SECURE=true for port 465). */
export interface SmtpConfig { host: string; port: number; user?: string; pass?: string; from: string; secure: boolean }

/** The settings from the environment, or null when e-mail is not set up. */
export function smtpFromEnv(env: Record<string, string | undefined> = process.env): SmtpConfig | null {
  const host = env.SMTP_HOST?.trim(), from = env.SMTP_FROM?.trim();
  if (!host || !from) return null;
  const port = Number(env.SMTP_PORT) || 587;
  return { host, port, user: env.SMTP_USER || undefined, pass: env.SMTP_PASS || undefined, from, secure: env.SMTP_SECURE === "true" || port === 465 };
}

/** What may be shown to staff: never the password. */
export const smtpSummary = (c: SmtpConfig | null) => (c ? { configured: true as const, host: c.host, port: c.port, user: c.user ?? null, from: c.from, secure: c.secure } : { configured: false as const });

const ADDRESS = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

export async function sendEmail(cfg: SmtpConfig, m: { to: string; subject: string; text: string; html?: string }): Promise<{ messageId: string }> {
  if (!ADDRESS.test(m.to)) throw new ProviderError("the e-mail address looks wrong", 400, "smtp");
  const transport = nodemailer.createTransport({
    host: cfg.host, port: cfg.port, secure: cfg.secure, auth: cfg.user ? { user: cfg.user, pass: cfg.pass ?? "" } : undefined,
    connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
  });
  try {
    const r = await transport.sendMail({ from: cfg.from, to: m.to, subject: m.subject.replace(/[\r\n]+/g, " ").slice(0, 200), text: m.text, html: m.html });
    return { messageId: String(r.messageId ?? "") };
  } catch (e) {
    throw new ProviderError(`the mail server refused it: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}`, 502, "smtp");
  } finally { transport.close(); }
}
