/**
 * Demo data for local development: one org, two teams, every role, leads, ~220 calls over 14 days with
 * transcripts and AI insights, voices with consents, knowledge docs and an audit trail.
 * Run against a development database only:  DATABASE_URL=... MFA_ENCRYPTION_KEY=... pnpm db:seed-demo
 * All accounts use the password below. Roles that require 2FA share DEMO_TOTP_SECRET; print the current
 * code with `pnpm --filter @voiceai/db demo:code`.
 */
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, inArray, isNull } from "drizzle-orm";
import { ROLE_KEYS, ROLE_PERMISSIONS, encryptSecret, hashPassword, parseKey, type RoleKey } from "@voiceai/auth";
import { chunkText, DEFAULT_DISCLOSURE, type LeadStatus, type TranscriptSegment } from "@voiceai/shared";
import { createDb } from "./client";
import * as t from "./schema";

export const DEMO_PASSWORD = "Passw0rd-long!";
export const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXP";

const url = process.env.DATABASE_URL;
const mfaKey = process.env.MFA_ENCRYPTION_KEY;
if (!url || !mfaKey) throw new Error("DATABASE_URL and MFA_ENCRYPTION_KEY are required");
if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");

// Cloned voice IDs for demo donors can be provided via env when needed.
//   KARAN_VOICE_ID=... NAVEEN_VOICE_ID=... SUHANI_VOICE_ID=... pnpm db:seed-demo

// Deterministic so the demo looks the same every time.
let seed = 20261022;
const rnd = () => ((seed = (seed + 0x6d2b79f5) | 0), ((((seed ^ (seed >>> 15)) * (1 | seed)) ^ 0) >>> 0) / 4294967296);
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const chance = (p: number) => rnd() < p;
const weighted = <T,>(xs: Array<[T, number]>): T => {
  let r = rnd() * xs.reduce((s, [, w]) => s + w, 0);
  for (const [x, w] of xs) if ((r -= w) <= 0) return x;
  return xs[0]![0];
};

const { db, pool } = createDb(url);

const [existing] = await db.select().from(t.organizations).where(eq(t.organizations.name, "Bizfy Demo"));
if (existing) {
  console.log("Demo org already exists; drop and recreate the dev database to reseed.");
  await pool.end();
  process.exit(0);
}

// ---- roles (system roles, shared)
for (const key of ROLE_KEYS) {
  await db.insert(t.roles).values({ key, name: key.replace(/_/g, " "), permissions: [...ROLE_PERMISSIONS[key]] })
    .onConflictDoUpdate({ target: [t.roles.orgId, t.roles.key], set: { permissions: [...ROLE_PERMISSIONS[key]] } });
}
const roleId = new Map((await db.select().from(t.roles).where(isNull(t.roles.orgId))).map((r) => [r.key, r.id]));

// ---- org, teams, users
const [org] = await db.insert(t.organizations).values({ name: "Bizfy Demo" }).returning();
const orgId = org!.id;
const [north, south] = await db.insert(t.teams).values([{ orgId, name: "Sales North" }, { orgId, name: "Sales South" }]).returning();

const passwordHash = await hashPassword(DEMO_PASSWORD);
const mfaEnc = encryptSecret(DEMO_TOTP_SECRET, parseKey(mfaKey));
const people: Array<{ email: string; role: RoleKey; team: typeof north | null }> = [
  { email: "admin@demo.io", role: "org_admin", team: null },
  { email: "manager.north@demo.io", role: "manager", team: north },
  { email: "manager.south@demo.io", role: "manager", team: south },
  { email: "asha@demo.io", role: "agent", team: north },
  { email: "ravi@demo.io", role: "agent", team: north },
  { email: "meera@demo.io", role: "agent", team: south },
  { email: "kabir@demo.io", role: "agent", team: south },
  { email: "qa@demo.io", role: "qa_auditor", team: north },
  { email: "viewer@demo.io", role: "viewer", team: null },
];
const mfaRoles: RoleKey[] = ["org_admin", "manager", "qa_auditor"];
const U = new Map<string, typeof t.users.$inferSelect>();
for (const p of people) {
  const [u] = await db.insert(t.users).values({
    orgId, teamId: p.team?.id ?? null, email: p.email, passwordHash, status: "active",
    mfaSecretEnc: mfaRoles.includes(p.role) ? mfaEnc : null, lastLoginAt: new Date(Date.now() - int(1, 48) * 3600_000),
  }).returning();
  U.set(p.email, u!);
  await db.insert(t.userRoles).values({ userId: u!.id, roleId: roleId.get(p.role)! });
}
await db.update(t.teams).set({ managerUserId: U.get("manager.north@demo.io")!.id }).where(eq(t.teams.id, north!.id));
await db.update(t.teams).set({ managerUserId: U.get("manager.south@demo.io")!.id }).where(eq(t.teams.id, south!.id));

const agents = ["asha@demo.io", "ravi@demo.io", "meera@demo.io", "kabir@demo.io"].map((e) => U.get(e)!);
const deviceRows: Array<typeof t.devices.$inferInsert> = agents.slice(0, 3).map((a, i) => ({
  orgId, teamId: a.teamId, userId: a.id, deviceFingerprint: `demo-device-${i}`, workSimSlot: i % 2,
  lastSyncAt: new Date(Date.now() - int(1, 30) * 60_000),
}));
deviceRows.push({
  orgId, teamId: agents[3]!.teamId, userId: agents[3]!.id, deviceFingerprint: "demo-device-old", workSimSlot: 0,
  lastSyncAt: new Date(Date.now() - 20 * 86400_000), revokedAt: new Date(Date.now() - 5 * 86400_000),
});
await db.insert(t.devices).values(deviceRows);

// ---- leads
const FIRST = ["Aarav", "Vivaan", "Aditya", "Ishaan", "Rohan", "Karthik", "Siddharth", "Arjun", "Priya", "Ananya", "Diya", "Neha", "Pooja", "Sneha", "Kavya", "Ritu", "Manoj", "Suresh", "Deepak", "Lakshmi", "Farhan", "Zoya", "Harpreet", "Gurpreet"];
const LAST = ["Sharma", "Verma", "Iyer", "Reddy", "Nair", "Patel", "Gupta", "Singh", "Khan", "Mehta", "Joshi", "Das", "Menon", "Kapoor", "Bose", "Rao"];
const SOURCES = ["Website", "Facebook Ads", "Referral", "IndiaMART", "Walk-in", "Google Ads"];
const TAGS = ["hot", "enterprise", "smb", "follow-up", "demo-booked", "price-sensitive"];
const STATUS_W: Array<[LeadStatus, number]> = [["new", 22], ["contacted", 25], ["interested", 20], ["callback_requested", 12], ["not_interested", 10], ["won", 7], ["lost", 4]];
const phones = new Set<string>();
const leadRows = Array.from({ length: 52 }, (_, i) => {
  let ph: string;
  do ph = `+91${pick(["98", "99", "97", "96", "88", "70"])}${int(10000000, 99999999)}`; while (phones.has(ph));
  phones.add(ph);
  const team = i % 2 ? south! : north!;
  const owner = agents.filter((a) => a.teamId === team.id)[i % 2 ? Math.floor(i / 2) % 2 : Math.floor(i / 2) % 2]!;
  const unknown = i >= 48;
  return {
    id: randomUUID(), orgId, teamId: team.id, ownerUserId: unknown ? null : owner.id,
    name: unknown ? null : `${pick(FIRST)} ${pick(LAST)}`, phoneE164: ph, email: unknown ? null : `lead${i}@example.com`,
    source: unknown ? "Unknown caller" : pick(SOURCES), status: unknown ? ("new" as LeadStatus) : weighted(STATUS_W),
    score: unknown ? null : int(20, 95), tags: chance(0.5) ? [pick(TAGS)] : [], dndFlag: chance(0.06),
    consentStatus: pick(["unknown", "granted", "granted"] as const), createdAt: new Date(Date.now() - int(2, 20) * 86400_000),
  };
});
await db.insert(t.leads).values(leadRows);

// ---- voices & consent
const donorA = U.get("asha@demo.io")!;
const donorB = U.get("ravi@demo.io")!;
const donorOld = U.get("kabir@demo.io")!;
const consents = await db.insert(t.consentRecords).values([
  { orgId, subjectType: "staff", subjectId: donorA.id, purpose: "AI voice for inbound and outbound calls", method: "written_signed", documentUrl: "s3://demo/consents/asha.pdf", grantedAt: new Date(Date.now() - 30 * 86400_000) },
  { orgId, subjectType: "staff", subjectId: donorB.id, purpose: "AI voice for inbound and outbound calls", method: "written_signed", documentUrl: "s3://demo/consents/ravi.pdf", grantedAt: new Date(Date.now() - 30 * 86400_000) },
  { orgId, subjectType: "staff", subjectId: donorOld.id, purpose: "AI voice for outbound campaigns", method: "written_signed", documentUrl: "s3://demo/consents/kabir.pdf", grantedAt: new Date(Date.now() - 60 * 86400_000), revokedAt: new Date(Date.now() - 6 * 86400_000) },
]).returning();
const voices = await db.insert(t.voiceProfiles).values([
  { orgId, label: "Priya (female)", gender: "female", providerVoiceId: "demo-voice-priya", donorUserId: donorA.id, consentRecordId: consents[0]!.id },
  { orgId, label: "Arjun (male)", gender: "male", providerVoiceId: "demo-voice-arjun", donorUserId: donorB.id, consentRecordId: consents[1]!.id },
  { orgId, label: "Kabir (male, old)", gender: "male", providerVoiceId: "demo-voice-kabir", donorUserId: donorOld.id, consentRecordId: consents[2]!.id, status: "revoked", revokedAt: new Date(Date.now() - 6 * 86400_000) },
]).returning();

// ---- Karan, Naveen, Suhani: seed donors and consents only (no placeholder voice profiles)
const donorEmails = ["donor-karan@voice-donor.invalid", "donor-naveen@voice-donor.invalid", "donor-suhani@voice-donor.invalid"];
const existingDonors = await db.select().from(t.users).where(inArray(t.users.email, donorEmails));
const donorByName = new Map(existingDonors.map((u) => [`${u.firstName} ${u.lastName}`, u.id]));
const clonedDonors = await db.insert(t.users).values([
  { orgId, teamId: null, email: donorEmails[0]!, firstName: "Karan", lastName: "Devda", passwordHash: "!", status: "disabled" },
  { orgId, teamId: null, email: donorEmails[1]!, firstName: "Naveen", lastName: "Sharma", passwordHash: "!", status: "disabled" },
  { orgId, teamId: null, email: donorEmails[2]!, firstName: "Suhani", lastName: "Verma", passwordHash: "!", status: "disabled" },
]).onConflictDoNothing().returning();
const donorIds = [
  donorByName.get("Karan Devda") ?? clonedDonors.find((u) => u.email === donorEmails[0]!)!.id,
  donorByName.get("Naveen Sharma") ?? clonedDonors.find((u) => u.email === donorEmails[1]!)!.id,
  donorByName.get("Suhani Verma") ?? clonedDonors.find((u) => u.email === donorEmails[2]!)!.id,
] as string[];
const existingConsents = await db.select().from(t.consentRecords).where(inArray(t.consentRecords.subjectId, donorIds));
const consentByName = new Map(existingConsents.map((c) => [c.subjectId, c.id]));
await db.insert(t.consentRecords).values([
  { orgId, subjectType: "staff", subjectId: donorIds[0]!, purpose: "AI voice for inbound and outbound calls", method: "written_signed", documentUrl: "s3://demo/consents/karan.pdf", grantedAt: new Date(Date.now() - 30 * 86400_000) },
  { orgId, subjectType: "staff", subjectId: donorIds[1]!, purpose: "AI voice for inbound and outbound calls", method: "written_signed", documentUrl: "s3://demo/consents/naveen.pdf", grantedAt: new Date(Date.now() - 30 * 86400_000) },
  { orgId, subjectType: "staff", subjectId: donorIds[2]!, purpose: "AI voice for inbound and outbound calls", method: "written_signed", documentUrl: "s3://demo/consents/suhani.pdf", grantedAt: new Date(Date.now() - 30 * 86400_000) },
]).onConflictDoNothing();
// ---- Cloned voices (Pocket TTS): re-register the profiles for the voice files that live in .local/voices.
// The files (.local/voices/<providerVoiceId>.*) are the real clone and survive a database rebuild; only the DB rows are
// lost, so every seed re-creates them from cloned-voices.json. Add a line there after cloning someone new.
const voicesDir = process.env.VOICES_DIR ?? join(import.meta.dirname, "../../../.local/voices");
const clonedManifest = JSON.parse(readFileSync(join(import.meta.dirname, "../cloned-voices.json"), "utf8")) as { slug: string; label: string; gender: "male" | "female"; providerVoiceId: string; donorEmail: string }[];
for (const c of clonedManifest) {
  if (!existsSync(join(voicesDir, `${c.providerVoiceId}.safetensors`))) { console.warn(`cloned voice ${c.slug}: voice files not found in ${voicesDir}, skipped`); continue; }
  const donorId = (await db.select().from(t.users).where(eq(t.users.email, c.donorEmail)))[0]!.id;
  const consentId = (await db.select().from(t.consentRecords).where(eq(t.consentRecords.subjectId, donorId)))[0]!.id;
  const [profile] = await db.insert(t.voiceProfiles).values({ orgId, label: c.label, slug: c.slug, gender: c.gender, provider: "pocket_tts", providerVoiceId: c.providerVoiceId, donorUserId: donorId, consentRecordId: consentId, isCloned: true }).returning();
  const ref = join(voicesDir, `${c.providerVoiceId}.ref.wav`);
  if (existsSync(ref)) { const audio = readFileSync(ref); await db.insert(t.voiceSamples).values({ orgId, voiceProfileId: profile!.id, mime: "audio/wav", bytes: audio.length, audio }); }
}
const activeVoices = voices.filter((v) => v.status === "active");

// ---- calls, transcripts, insights
interface Scenario {
  intent: string; label: "positive" | "neutral" | "negative"; score: number; summary: string; next: string;
  suggested: LeadStatus | null; confidence: number | null; handoff?: boolean;
  lines: Array<["caller" | "reply", string, boolean?]>;
}
const SCENARIOS: Scenario[] = [
  { intent: "pricing_enquiry", label: "positive", score: 0.6, summary: "Caller asked about Business plan pricing and annual discounts. Interested; wants the full details.", next: "Send pricing deck and follow up in 2 days", suggested: "interested", confidence: 0.86,
    lines: [["caller", "Hi, I wanted to know the pricing for the business plan."], ["reply", "Our Business plan starts at ₹4,999 per month and includes up to ten users, plus the call—", true], ["caller", "Sorry, is there a discount if I pay annually?"], ["reply", "Yes, annual billing saves fifteen percent. I can send the full details and have a specialist follow up."], ["caller", "Please do. Thank you."]] },
  { intent: "demo_request", label: "positive", score: 0.7, summary: "Caller requested a demo of call tracking and agreed to a Thursday afternoon slot.", next: "Confirm demo slot on Thursday afternoon", suggested: "callback_requested", confidence: 0.9,
    lines: [["caller", "Can I get a demo of the call tracking feature?"], ["reply", "Of course. Which day works for you this week?"], ["caller", "Thursday afternoon would be fine."], ["reply", "Booked for Thursday afternoon. You will get a confirmation message shortly."]] },
  { intent: "billing_complaint", label: "negative", score: -0.6, summary: "Caller reports a duplicate charge last month that has not been fixed. Transferred to a human agent.", next: "Escalate to billing and call back within one hour", suggested: null, confidence: null, handoff: true,
    lines: [["caller", "I was charged twice last month and nobody has fixed it."], ["reply", "I am sorry about that. Let me connect you with a colleague who can resolve billing issues."], ["caller", "Fine, please hurry."]] },
  { intent: "not_interested", label: "neutral", score: -0.1, summary: "Caller is not looking for the service right now and asked to end the conversation.", next: "Pause outreach for 60 days", suggested: "not_interested", confidence: 0.82,
    lines: [["caller", "I am not looking for this right now."], ["reply", "Understood, thank you for your time. Have a good day."]] },
  { intent: "callback_request", label: "neutral", score: 0.2, summary: "Caller was busy and asked for a call back tomorrow at 11 AM.", next: "Call back tomorrow at 11:00", suggested: "callback_requested", confidence: 0.92,
    lines: [["caller", "I am driving right now, can you call me tomorrow at eleven?"], ["reply", "Sure, I will arrange a callback tomorrow at 11 AM."], ["caller", "Great, thanks."]] },
  { intent: "product_question", label: "positive", score: 0.4, summary: "Caller asked whether recordings are stored in India and how long they are kept. Answered from the knowledge base.", next: "Share data-retention policy", suggested: "interested", confidence: 0.71,
    lines: [["caller", "Where are my call recordings stored, and for how long?"], ["reply", "Recordings are stored in India, encrypted, and kept for one hundred eighty days by default."], ["caller", "Good, that is what our compliance team needs."]] },
];

const ts = (offsetDays: number) => {
  const d = new Date(Date.now() - offsetDays * 86400_000);
  d.setHours(0, 0, 0, 0);
  // Today's calls only go up to the current hour, so they spread out instead of piling up at "now".
  const lastHour = offsetDays === 0 ? Math.max(9, new Date().getHours() - 1) : 20;
  const at = d.getTime() + int(9, lastHour) * 3600_000 + int(0, 59) * 60_000;
  return new Date(Math.min(at, Date.now() - 120_000));
};

const callRows: Array<typeof t.callLogs.$inferInsert> = [];
const transcripts: Array<typeof t.callTranscripts.$inferInsert> = [];
const insights: Array<typeof t.callInsights.$inferInsert> = [];
const callsByLead = new Map<string, string[]>();

for (let i = 0; i < 220; i++) {
  const lead = pick(leadRows);
  const source = weighted<"ai_inbound" | "ai_outbound" | "web_dialer" | "mobile_sim">([["ai_inbound", 30], ["ai_outbound", 15], ["web_dialer", 25], ["mobile_sim", 30]]);
  const ai = source.startsWith("ai_");
  const direction = source === "ai_inbound" ? "inbound" : source === "ai_outbound" || source === "web_dialer" ? "outbound" : weighted<"inbound" | "outbound">([["inbound", 40], ["outbound", 60]]);
  // Unassigned (unknown-caller) leads are worked by an agent from the lead's own team.
  const owner = agents.find((a) => a.id === lead.ownerUserId) ?? pick(agents.filter((a) => a.teamId === lead.teamId));
  const agentUserId = ai ? null : owner.id;
  const status = direction === "inbound"
    ? weighted<"connected" | "missed" | "rejected" | "failed">([["connected", 70], ["missed", 26], ["rejected", 2], ["failed", 2]])
    : weighted<"connected" | "missed" | "rejected" | "failed">([["connected", 62], ["rejected", 18], ["failed", 20]]);
  const connected = status === "connected";
  const durationS = connected ? int(25, 540) : 0;
  const id = randomUUID();
  const scenario = pick(SCENARIOS);
  const handoff = ai && connected && scenario.handoff;
  const day = weighted([[0, 14], [1, 14], [2, 12], [3, 11], [4, 10], [5, 9], [6, 8], [7, 6], [8, 5], [9, 4], [10, 3], [11, 2], [12, 1], [13, 1]] as Array<[number, number]>);
  callRows.push({
    id, orgId, teamId: ai ? lead.teamId : owner.teamId, leadId: lead.id, agentUserId, voiceProfileId: ai ? pick(activeVoices).id : null, direction, source, status,
    startedAt: ts(day), durationS, providerCallUuid: source === "mobile_sim" ? null : `demo-${id.slice(0, 8)}`,
    recordingKey: connected && durationS > 40 && source !== "mobile_sim" || (connected && source === "mobile_sim" && chance(0.4)) ? `demo/${id}.wav` : null,
    handoffToUserId: handoff ? owner.id : null, idempotencyKey: source === "mobile_sim" ? `demo-device:${id}` : null,
  });
  callsByLead.set(lead.id, [...(callsByLead.get(lead.id) ?? []), id]);

  if (connected && durationS > 40) {
    const segments: TranscriptSegment[] = [];
    const speakerReply = ai ? "ai" : "agent";
    const lines: Array<[TranscriptSegment["speaker"], string, boolean?]> = [];
    if (ai) lines.push(["ai", DEFAULT_DISCLOSURE], ["ai", "Thanks for calling. How can I help you today?"]);
    else lines.push(["agent", `Hello, this is ${owner.email.split("@")[0]} from Bizfy. Am I speaking with ${lead.name ?? "the caller"}?`], ["caller", "Yes, speaking."]);
    for (const [who, text, cut] of scenario.lines) lines.push([who === "caller" ? "caller" : speakerReply, text, cut]);
    const step = (durationS * 1000) / lines.length;
    lines.forEach(([speaker, text, cut], k) => segments.push({ speaker, startMs: Math.round(k * step), endMs: Math.round((k + 1) * step) - 300, text, ...(cut && ai ? { interrupted: true } : {}) }));
    transcripts.push({ callLogId: id, orgId, teamId: lead.teamId, segments, language: chance(0.12) ? "hi" : "en" });
    insights.push({
      callLogId: id, orgId, teamId: lead.teamId, summary: scenario.summary, sentimentScore: Math.max(-1, Math.min(1, scenario.score + (rnd() - 0.5) * 0.2)),
      sentimentLabel: scenario.label, intent: scenario.intent, nextAction: scenario.next, suggestedStatus: scenario.suggested,
      suggestedStatusConfidence: scenario.confidence, modelVersion: "askg1-demo",
    });
  }
}
await db.insert(t.callLogs).values(callRows);
await db.insert(t.callTranscripts).values(transcripts);
await db.insert(t.callInsights).values(insights);

// ---- lead status history
const history: Array<typeof t.leadStatusHistory.$inferInsert> = [];
for (const l of leadRows) {
  if (l.status === "new") continue;
  const path = (["new", "contacted", l.status] as LeadStatus[]).filter((s, i, a) => i === 0 || s !== a[i - 1]);
  path.slice(1).forEach((to, k) => {
    const byAi = chance(0.45);
    history.push({
      orgId, teamId: l.teamId, leadId: l.id, fromStatus: path[k]!, toStatus: to, changedBy: byAi ? "ai" : "user",
      changedByUserId: byAi ? null : l.ownerUserId, reason: byAi ? "Suggested from call insight" : "Updated after call", confidence: byAi ? Number((0.8 + rnd() * 0.18).toFixed(2)) : null,
      callLogId: pick(callsByLead.get(l.id) ?? [null as unknown as string]) ?? null, createdAt: new Date(Date.now() - int(1, 12) * 86400_000 + k * 3600_000),
    });
  });
}
if (history.length) await db.insert(t.leadStatusHistory).values(history);

// ---- knowledge base (real text so the agent console has something to retrieve; embeddings come later)
const KB: Array<[string, string | null, string]> = [
  ["Pricing and plans", "https://example.com/pricing",
    "The Starter plan costs 1,999 rupees per month and includes up to 3 users and call recording for 30 days.\n\nThe Business plan starts at 4,999 rupees per month and includes up to 10 users, the AI phone assistant, call tracking for agent mobile phones, and transcripts with AI summaries. Paying annually saves 15 percent.\n\nThe Enterprise plan is priced on request and adds single sign-on, a dedicated onboarding manager, custom data retention and priority support. All plans include unlimited leads."],
  ["Data security and retention policy", "https://example.com/security",
    "All call recordings, transcripts and cloned voices are stored in India in encrypted storage. Recordings are kept for 180 days by default and transcripts for one year. Both periods can be changed per organisation in Settings.\n\nRecordings can only be played through short-lived secure links, and every play is written to the audit log. Staff voice clones are only created with the written consent of the person, and are deleted within 24 hours if that person withdraws consent or leaves the company."],
  ["Call tracking setup guide", null,
    "To track calls made from an agent's own phone, install the agent app, sign in with your company account and choose the work SIM. Only calls on that SIM are read. Your personal SIM and contacts are never accessed.\n\nCalls sync every two minutes and whenever a call ends. If the phone is offline, calls are stored securely on the phone and uploaded when the network returns. After each call the app asks for an outcome such as Interested, Callback or Not interested, which updates the lead.\n\nCall recording depends on the phone. Android 10 and newer block most third-party recording, so calls are recorded only if the phone's own dialer records them."],
];
for (const [title, sourceUrl, text] of KB) {
  const [d] = await db.insert(t.kbDocuments).values({ orgId, title, sourceUrl, metadata: { chars: text.length } }).returning();
  const parts = chunkText(text, 500, 60);
  await db.insert(t.kbChunks).values(parts.map((content, i) => ({ orgId, documentId: d!.id, chunkIndex: i, content })));
}

// ---- studio projects and provider usage
const wav = (seconds: number, base: number): Buffer => {
  const rate = 8000, n = rate * seconds, buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const tt = i / rate; buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * (base + 90 * Math.sin(tt * 2)) * tt) * Math.max(0, Math.sin(tt * 3)) * 4500), 44 + i * 2); }
  return buf;
};
const adminU = U.get("admin@demo.io")!;
const mgrU = U.get("manager.north@demo.io")!;
await db.insert(t.studioAssets).values([
  { orgId, teamId: null, userId: adminU.id, kind: "speech", title: "Welcome greeting", text: "Thanks for calling Bizfy. This call is recorded. How can I help you today?", provider: "deepgram", voiceRef: "dg:aura-2-thalia-en", mime: "audio/wav", audio: wav(4, 300), createdAt: new Date(Date.now() - 2 * 86400_000) },
  { orgId, teamId: north!.id, userId: mgrU.id, kind: "speech", title: "Callback confirmation", text: "Hello, this is a reminder that we will call you back tomorrow at eleven in the morning.", provider: "deepgram", voiceRef: "dg:aura-2-apollo-en", mime: "audio/wav", audio: wav(3, 220), createdAt: new Date(Date.now() - 86400_000) },
  { orgId, teamId: null, userId: adminU.id, kind: "transcript", title: "Customer interview (demo)", provider: "deepgram", mime: null, audio: null, durationMs: 41000,
    text: "Thanks for joining. We mostly use it to follow up on missed calls. The recordings help a lot.",
    meta: { language: "en", segments: [{ speaker: 0, startMs: 800, endMs: 5200, text: "Thanks for joining. How is the team using the call tracking today?" }, { speaker: 1, startMs: 5800, endMs: 12400, text: "We mostly use it to follow up on missed calls. The recordings help a lot." }] }, createdAt: new Date(Date.now() - 3 * 86400_000) },
]);
const ops: Array<[string, string, number, number]> = [["deepgram", "speech", 900, 1500], ["deepgram", "transcription", 700, 1200], ["askg1", "chat", 350, 600], ["elevenlabs", "speech", 600, 900]];
await db.insert(t.providerUsage).values(Array.from({ length: 48 }, () => {
  const [provider, operation, ms, spread] = pick(ops);
  const fail = chance(0.06);
  return { orgId, userId: pick([adminU, mgrU]).id, provider, operation, status: fail ? "error" : "ok", latencyMs: ms + int(0, spread), units: operation === "transcription" ? int(10, 180) : int(40, 900), error: fail ? "Upstream timeout after 10s" : null, createdAt: new Date(Date.now() - int(1, 1380) * 60_000) };
}));

// ---- audit trail
const admin = U.get("admin@demo.io")!;
const manager = U.get("manager.north@demo.io")!;
const auditRows: Array<typeof t.auditLogs.$inferInsert> = [];
const add = (actor: typeof admin, action: string, entity: string, daysAgo: number, entityId?: string) =>
  auditRows.push({ orgId, actorUserId: actor.id, action, entity, entityId, ip: `203.0.113.${int(2, 250)}`, userAgent: "Mozilla/5.0", at: new Date(Date.now() - daysAgo * 86400_000 - int(0, 80000) * 1000) });
for (let d = 0; d < 10; d++) { add(admin, "login.success", "users", d, admin.id); add(manager, "login.success", "users", d, manager.id); }
add(admin, "consent.create", "consent_records", 30, consents[0]!.id); add(admin, "voice_profile.create", "voice_profiles", 30, voices[0]!.id);
add(admin, "consent.create", "consent_records", 30, consents[1]!.id); add(admin, "voice_profile.create", "voice_profiles", 30, voices[1]!.id);
add(admin, "voice_profile.revoke", "voice_profiles", 6, voices[2]!.id); add(admin, "device.revoke", "devices", 5);
add(manager, "recording.play", "call_logs", 2, callRows[3]!.id); add(manager, "recording.play", "call_logs", 1, callRows[8]!.id);
add(admin, "org_settings.update", "organizations", 3, orgId); add(manager, "login.failed", "users", 4, manager.id);
await db.insert(t.auditLogs).values(auditRows);

await pool.end();
console.log(`Seeded demo org: ${leadRows.length} leads, ${callRows.length} calls, ${transcripts.length} transcripts, ${voices.length} voices.`);
console.log(`Logins: ${people.map((p) => p.email).join(", ")}  password: ${DEMO_PASSWORD}`);
console.log(`2FA roles (admin, managers, QA) use secret ${DEMO_TOTP_SECRET}; current code: pnpm --filter @voiceai/db demo:code`);
