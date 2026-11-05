import { getKyc } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { KycPanel } from "@/components/kyc-panel";
import { PageHeader } from "@/components/ui/page-header";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

export default async function KycPage() {
  const user = await requirePageUser();
  const data = await allowed(() => getKyc(getDb(), user));
  if (!data) return <Forbidden />;
  return (
    <>
      <PageHeader title="KYC verification" description="Verify your organisation. Some features can be made to require it (Settings)." />
      <KycPanel tier={data.tier} canSubmit={user.permissions.includes("org_settings.write")} submissions={data.submissions.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() }))} />
    </>
  );
}
