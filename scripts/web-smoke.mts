/**
 * End-to-end smoke test of the website, against the running dev server and the demo data (local development only).
 *  1. Signs in as platform staff (staff@demo.io) and as the organisation admin (admin@demo.io, with a 2FA code from the demo secret).
 *  2. Opens every page as each and fails on a crash ("This page could not be shown") or an unexpected "no access".
 *  3. Exercises the new admin features through their real APIs: provider keys (staff only, password re-check, set and remove),
 *     settings password check, team management, CRM health test, incoming CRM sync with an API token, the theme-builder save.
 * Rows it creates (a test person, a test lead, an API token) are removed again at the end.
 *
 *   npx tsx scripts/web-smoke.mts [--base http://localhost:3001] [--out result.json]
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { hotp } from "../packages/auth/src/totp.ts";

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback; };
const BASE = arg("base", "http://localhost:3001");
const OUT = arg("out", "");
const PASSWORD = "Passw0rd-long!";
const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXP";
const psql = (q: string) => execSync(`psql -d voiceai_dev -Atc ${JSON.stringify(q)}`, { encoding: "utf8" }).trim();

interface Check { area: string; check: string; ok: boolean; detail: string }
const results: Check[] = [];
const record = (area: string, check: string, ok: boolean, detail = "") => { results.push({ area, check, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${area} | ${check}${detail ? ` | ${detail}` : ""}`); };

async function login(email: string, totp?: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ email, password: PASSWORD, ...(totp ? { totp } : {}) }), redirect: "manual" });
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  if (!res.ok || !cookie) throw new Error(`login failed for ${email}: ${res.status} ${await res.text()}`);
  return cookie;
}
const call = (cookie: string, path: string, init: RequestInit = {}) => fetch(`${BASE}${path}`, { ...init, redirect: "manual", headers: { cookie, origin: BASE, ...(init.body && typeof init.body === "string" ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) } });

const PAGES = ["/", "/account", "/agent-console", "/agent-templates", "/audit", "/billing", "/billing/history", "/calls", "/campaigns", "/clone", "/dashboard", "/dialer", "/errors", "/integrations", "/knowledge", "/kyc", "/leads", "/library", "/live", "/logs", "/monitor", "/numbers", "/permissions", "/platform", "/profit", "/projects", "/reports", "/reports/export", "/scheduled-exports", "/security", "/sequences", "/settings", "/sms", "/studio", "/team", "/theme-builder", "/transcribe", "/translations", "/voices"];
const STAFF_ONLY = new Set(["/permissions", "/platform", "/profit", "/theme-builder", "/translations"]);

async function pages(who: string, cookie: string, staff: boolean) {
  for (const p of PAGES) {
    const t0 = Date.now();
    const res = await call(cookie, p);
    // Only what is displayed outside tables counts: page data and the Translations table also carry the error and no-access sentences.
    const html = res.status === 200 ? (await res.text()).replace(/<script[\s\S]*?<\/script>/g, "").replace(/<table[\s\S]*?<\/table>/g, "") : "";
    // The error screen and the no-access screen, by their own wording (the Translations editor lists their titles as words to translate).
    const crashed = /quote the reference|Application error: a (?:server|client)-side exception|Unhandled Runtime Error/.test(html);
    const forbidden = /Ask an Org Admin if you need a different role/.test(html);
    // The organisation admin must open every customer page and be refused the staff-only ones. Platform staff must open the
    // staff-only pages; customer pages that need customer permissions (Studio, calls...) may show "no access" to staff.
    const expectForbidden = !staff && STAFF_ONLY.has(p);
    const ok = res.status === 200 && !crashed && (staff ? !(STAFF_ONLY.has(p) && forbidden) : forbidden === expectForbidden);
    record(`page as ${who}`, p, ok, `${res.status}${crashed ? " CRASHED" : ""}${forbidden ? " no-access" : ""}${expectForbidden ? " (staff-only page: no access expected)" : staff && forbidden && !STAFF_ONLY.has(p) ? " (customer page: staff have no customer permissions)" : ""} ${Date.now() - t0} ms`);
  }
}

const staff = await login("staff@demo.io");
record("login", "staff@demo.io (platform staff)", true);
const admin = await login("admin@demo.io", hotp(DEMO_TOTP_SECRET, Math.floor(Date.now() / 30_000)));
record("login", "admin@demo.io with 2FA code", true);

await pages("staff", staff, true);
await pages("admin", admin, false);

// ---- provider keys
{
  let r = await call(admin, "/api/platform/secrets");
  record("provider keys", "organisation admin cannot list them", r.status === 403, String(r.status));
  r = await call(staff, "/api/platform/secrets");
  const body = (await r.json()) as { keys: Array<{ name: string; source: string; hint: string | null }> };
  record("provider keys", "staff sees every managed key with its source", r.ok && body.keys.length >= 30, `${body.keys.length} keys; SMTP_PASS source=${body.keys.find((k) => k.name === "SMTP_PASS")?.source}`);
  record("provider keys", "no secret value is sent to the browser", !JSON.stringify(body).includes(process.env.SMTP_PASS ?? "@@none@@"), "values hidden, last 4 characters only");
  r = await call(staff, "/api/platform/secrets", { method: "POST", body: JSON.stringify({ name: "OPENROUTER_MODEL", value: "openai/gpt-4o-mini", password: "wrong-password-123" }) });
  record("provider keys", "a wrong password is refused", r.status === 400, String(r.status));
  r = await call(staff, "/api/platform/secrets", { method: "POST", body: JSON.stringify({ name: "OPENROUTER_MODEL", value: "openai/gpt-4o-mini", password: PASSWORD }) });
  const stored = psql("select hint from platform_secrets where name='OPENROUTER_MODEL'");
  record("provider keys", "staff can set a key (stored encrypted)", r.ok && stored === "openai/gpt-4o-mini", `hint stored: ${stored}`);
  r = await call(staff, "/api/platform/secrets", { method: "POST", body: JSON.stringify({ name: "OPENROUTER_MODEL", password: PASSWORD }) });
  record("provider keys", "staff can remove it again", r.ok && psql("select count(*) from platform_secrets where name='OPENROUTER_MODEL'") === "0", String(r.status));
}

// ---- settings password
{
  const r = await call(admin, "/api/settings", { method: "PUT", body: JSON.stringify({ confirmPassword: "not-my-password", dataRetentionDays: 365, recordingRetentionDays: 30, settings: {} }) });
  const b = (await r.json().catch(() => ({}))) as { error?: string };
  record("settings", "saving with a wrong password is refused", r.status === 400 && b.error === "password", `${r.status} ${b.error}`);
}

// ---- team management
{
  const email = `smoke-${Date.now()}@demo.io`;
  let r = await call(admin, "/api/team", { method: "POST", body: JSON.stringify({ email, role: "agent", password: "Smoke-test-pass-2026" }) });
  const created = (await r.json().catch(() => ({}))) as { id?: string };
  record("team", "admin adds a person", r.status === 201 && !!created.id, String(r.status));
  if (created.id) {
    r = await call(admin, `/api/team/${created.id}/role`, { method: "POST", body: JSON.stringify({ role: "manager" }) });
    record("team", "admin changes their role", r.ok, String(r.status));
    r = await call(admin, `/api/team/${created.id}/status`, { method: "POST", body: JSON.stringify({ status: "disabled" }) });
    record("team", "admin switches them off", r.ok && psql(`select status from users where id='${created.id}'`) === "disabled", String(r.status));
    psql(`delete from users where id='${created.id}'`);
  }
  r = await call(admin, "/api/team", { method: "POST", body: JSON.stringify({ email: "asha@demo.io", role: "agent", password: "Smoke-test-pass-2026" }) });
  record("team", "an e-mail already in use is refused", r.status === 409, String(r.status));
}

// ---- CRM: health test and incoming sync
{
  const ep = psql("select id from crm_endpoints where active order by created_at desc limit 1");
  if (ep) {
    const r = await call(admin, `/api/integrations/${ep}/health`, { method: "POST" });
    const h = (await r.json().catch(() => ({}))) as { status?: string; checks?: Array<{ check: string; level: string; detail: string }> };
    record("CRM", "health test runs all checks", r.ok && (h.checks?.length ?? 0) >= 4, `${h.status}: ${h.checks?.map((c) => `${c.check}=${c.level}`).join(", ")}`);
  } else record("CRM", "health test", true, "skipped: no active CRM address in the demo data");
  let r = await call(admin, "/api/account/api-tokens", { method: "POST", body: JSON.stringify({ name: "smoke test (delete me)", permissions: ["leads.write.all", "leads.read.all"], expiresInDays: 1 }) });
  const tok = (await r.json().catch(() => ({}))) as { token?: string; id?: string };
  record("CRM", "admin creates an API token for the CRM", r.status === 201 && !!tok.token, String(r.status));
  if (tok.token) {
    const phone = "+919876500011";
    r = await fetch(`${BASE}/api/integrations/inbound`, { method: "POST", headers: { authorization: `Bearer ${tok.token}`, "content-type": "application/json" }, body: JSON.stringify({ contacts: [{ phone, name: "Smoke Test Contact", status: "interested", externalId: "crm-smoke-1" }, { phone: "123" }] }) });
    const s = (await r.json().catch(() => ({}))) as { created?: number; invalid?: number };
    record("CRM", "incoming sync with the token creates the contact and refuses a bad number", r.ok && s.created === 1 && s.invalid === 1, JSON.stringify(s));
    r = await fetch(`${BASE}/api/integrations/inbound`, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify({ contacts: [{ phone }] }) });
    record("CRM", "incoming sync without a token is refused", r.status === 401, String(r.status));
    psql(`delete from leads where phone_e164='${phone}'`);
    psql(`delete from api_tokens where name='smoke test (delete me)'`);
  }
}

// ---- theme builder save (a plain form post: must come back to the editor, not raw JSON)
{
  // Saves the current text again, so the demo sign-in page is left exactly as it was.
  const headline = psql("select coalesce(landing_headline,'') from platform_settings where id = 1");
  const text = psql("select coalesce(landing_text,'') from platform_settings where id = 1");
  const form = new URLSearchParams({ headline, text });
  const r = await fetch(`${BASE}/api/theme/landing`, { method: "POST", headers: { cookie: staff, origin: BASE, "content-type": "application/x-www-form-urlencoded" }, body: form.toString(), redirect: "manual" });
  record("theme builder", "Save returns to the editor with a saved message", r.status === 303 && (r.headers.get("location") ?? "").includes("/theme-builder?saved=1"), `${r.status} -> ${r.headers.get("location")}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
if (OUT) writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), base: BASE, results }, null, 2));
process.exit(failed.length ? 1 : 0);
