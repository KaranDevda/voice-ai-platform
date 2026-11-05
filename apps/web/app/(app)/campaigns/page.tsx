import { callTimingStats, listCampaigns } from "@voiceai/db";
import { CampaignsAdmin } from "@/components/campaigns-admin";
import { Forbidden } from "@/components/forbidden";
import { PageHeader } from "@/components/ui/page";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

export default async function CampaignsPage() {
  const user = await requirePageUser();
  const rows = await allowed(() => listCampaigns(getDb(), user));
  if (!rows) return <Forbidden />;
  const timing = await allowed(() => callTimingStats(getDb(), user));
  return (
    <>
      <PageHeader title="Campaigns" description="AI calls to everyone with a tag, on a schedule. Do Not Disturb, consent and calling hours (9:00 to 21:00 India time) are checked before every call." />
      <CampaignsAdmin timing={timing ? { totalAttempts: timing.totalAttempts, days: timing.days, minAttempts: timing.minAttempts, best: timing.best, hours: timing.hours.filter((h) => h.hourIst >= 9 && h.hourIst < 21) } : null} campaigns={rows.map((c) => ({ id: c.id, name: c.name, status: c.status, language: c.language, startAt: c.startAt?.toISOString() ?? null, maxConcurrent: c.maxConcurrent, maxAttempts: c.maxAttempts, retryDelayMin: c.retryDelayMin, counts: c.counts, total: c.total, detectMachines: c.detectMachines, variants: c.variants }))} />
    </>
  );
}
