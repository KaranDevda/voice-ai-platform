import { getBilling, listCountryRates, listExchangeRates } from "@voiceai/db";
import { BillingPanel } from "@/components/billing-panel";
import { Forbidden } from "@/components/forbidden";
import { PageHeader } from "@/components/ui/page";
import { gatewayConfigured } from "@/lib/payments";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

export default async function BillingPage() {
  const user = await requirePageUser();
  const data = await allowed(() => getBilling(getDb(), user));
  const rates = await allowed(() => listCountryRates(getDb(), user));
  const exchange = await allowed(() => listExchangeRates(getDb(), user));
  if (!data || !rates || !exchange) return <Forbidden />;
  return (
    <>
      <PageHeader title="Billing" description="Prepaid credit for AI calls and texts. The standard prices and the on/off switch are in Settings." />
      <BillingPanel
        balancePaise={data.balancePaise} billing={data.billing} canEdit={user.permissions.includes("org_settings.write")} isPlatformAdmin={user.permissions.includes("platform.admin")}
        gateways={gatewayConfigured()} rates={rates} exchange={exchange.map((e) => ({ currency: e.currency, paisePerUnit: e.paisePerUnit }))}
        ledger={data.ledger.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() }))} payments={data.payments.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() }))}
      />
    </>
  );
}
