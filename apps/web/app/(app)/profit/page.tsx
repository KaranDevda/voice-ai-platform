import { getDefaultMargin, listCarrierCosts, profitReport } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { ProfitPanel } from "@/components/profit-panel";
import { PageHeader } from "@/components/ui/page-header";
import { requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

export default async function ProfitPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await requirePageUser();
  if (!user.permissions.includes("platform.admin")) return <Forbidden />;
  const days = [7, 30, 90].includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 30;
  const [report, carrierCosts, defaultMarginPct] = await Promise.all([profitReport(getDb(), user, days), listCarrierCosts(getDb(), user), getDefaultMargin(getDb(), user)]);
  return (
    <>
      <PageHeader title="Profit" description="What customers were charged, an estimate of what the carrier cost, and the difference. Staff only." />
      <ProfitPanel report={report} carrierCosts={carrierCosts} defaultMarginPct={defaultMarginPct} />
    </>
  );
}
