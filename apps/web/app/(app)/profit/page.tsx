import { profitReport } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { ProfitPanel } from "@/components/profit-panel";
import { PageHeader } from "@/components/ui/page";
import { requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

export default async function ProfitPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await requirePageUser();
  if (!user.permissions.includes("platform.admin")) return <Forbidden />;
  const days = [7, 30, 90].includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 30;
  const report = await profitReport(getDb(), user, days);
  return (
    <>
      <PageHeader title="Profit" description="What customers were charged, an estimate of what the carrier cost, and the difference. Staff only." />
      <ProfitPanel report={report} />
    </>
  );
}
