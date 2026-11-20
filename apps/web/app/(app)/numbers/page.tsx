import { listMyNumbers, listMyTrunks } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { NumbersPanel } from "@/components/numbers-panel";
import { TrunksPanel } from "@/components/trunks-panel";
import { PageHeader } from "@/components/ui/page-header";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { isTwilioConfigured } from "@/lib/providers";
import { getDb } from "@/lib/server";

export default async function NumbersPage() {
  const user = await requirePageUser();
  const data = await allowed(() => listMyNumbers(getDb(), user));
  if (!data) return <Forbidden />;
  // SIP trunks (BYOC) are offered on Twilio installations only.
  const trunks = isTwilioConfigured() ? await allowed(() => listMyTrunks(getDb(), user)) : null;
  const canManage = user.permissions.includes("org_settings.write");
  return (
    <>
      <PageHeader title="Phone numbers" description="The numbers your organisation uses, and requests for new ones." />
      <div className="grid gap-6">
        <NumbersPanel canRequest={canManage} numbers={data.numbers.map((n) => ({ ...n, assignedAt: n.assignedAt?.toISOString() ?? null }))} requests={data.requests.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))} />
        {trunks && <TrunksPanel canManage={canManage} trunks={trunks.trunks.map((t) => ({ ...t, lastCheckedAt: t.lastCheckedAt?.toISOString() ?? null }))} numbers={trunks.numbers} />}
      </div>
    </>
  );
}
