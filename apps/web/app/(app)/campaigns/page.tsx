import { callTimingStats, listAgentProfiles, listCampaignCallerIds, listCampaigns, listCampaignTemplates } from "@voiceai/db";
import { CampaignsAdmin } from "@/components/campaigns-admin";
import { Forbidden } from "@/components/forbidden";
import { PageHeader } from "@/components/ui/page-header";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

export default async function CampaignsPage() {
  const user = await requirePageUser();
  const rows = await allowed(() => listCampaigns(getDb(), user));
  if (!rows) return <Forbidden />;
  const savedTemplates = await allowed(() => listCampaignTemplates(getDb(), user));
  const agentProfiles = await allowed(() => listAgentProfiles(getDb(), user));
  const callerIds = await allowed(() => listCampaignCallerIds(getDb(), user));
  const timing = await allowed(() => callTimingStats(getDb(), user));
  return (
    <>
      <PageHeader title="Campaigns" description="AI calls to everyone with a tag, on a schedule. Do Not Disturb, consent and calling hours (9:00 to 21:00 India time) are checked before every call." />
      <CampaignsAdmin agentProfiles={agentProfiles ?? []} callerIds={callerIds ?? []} templates={(savedTemplates ?? []).map((t) => ({ id: t.id, name: t.name, language: t.language as "en" | "hi" | "en-hi", tags: t.tags, callerId: t.callerId, aiModel: t.aiModel, openrouterModel: t.openrouterModel, agentProfileId: t.agentProfileId, autoSchedule: t.autoSchedule, maxConcurrent: t.maxConcurrent, maxAttempts: t.maxAttempts, retryDelayMin: t.retryDelayMin, detectMachines: t.detectMachines, mode: t.mode as "ai" | "audio", openingVariants: t.openingVariants }))} timing={timing ? { totalAttempts: timing.totalAttempts, days: timing.days, minAttempts: timing.minAttempts, best: timing.best, hours: timing.hours.filter((h) => h.hourIst >= 9 && h.hourIst < 21) } : null} campaigns={rows.map((c) => ({ id: c.id, name: c.name, status: c.status, language: c.language, callerId: c.callerId, aiModel: c.aiModel, openrouterModel: c.openrouterModel, agentProfileId: c.agentProfileId, startAt: c.startAt?.toISOString() ?? null, maxConcurrent: c.maxConcurrent, maxAttempts: c.maxAttempts, retryDelayMin: c.retryDelayMin, counts: c.counts, total: c.total, connected: c.connected, detectMachines: c.detectMachines, variants: c.variants, mode: c.mode, audioName: c.audioName }))} />
    </>
  );
}
