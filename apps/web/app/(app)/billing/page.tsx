import { getBilling, listCountryRates, listExchangeRates, platformBalances, usageSummary } from "@voiceai/db";
import { BillingPanel } from "@/components/billing-panel";
import { Forbidden } from "@/components/forbidden";
import { PageHeader } from "@/components/ui/page-header";
import { gatewayConfigured, gatewayStatus } from "@/lib/payments";
import { headers } from "next/headers";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

export default async function BillingPage() {
  const user = await requirePageUser();
  const data = await allowed(() => getBilling(getDb(), user));
  const rates = await allowed(() => listCountryRates(getDb(), user));
  const exchange = await allowed(() => listExchangeRates(getDb(), user));
  const usage = await allowed(() => usageSummary(getDb(), user, 30));
  if (!data || !rates || !exchange || !usage) return <Forbidden />;
  const staff = user.permissions.includes("platform.admin");
  const balances = staff ? await platformBalances(getDb(), user, 30) : undefined;
  const h = await headers();
  const base = (process.env.APP_URL?.trim() || `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`).replace(/\/$/, "");
  return (
    <>
      <PageHeader title="Billing" description="Prepaid credit for AI calls and texts. The standard prices and the on/off switch are in Settings." />
      <BillingPanel
        balancePaise={data.balancePaise} billing={data.billing} canEdit={user.permissions.includes("org_settings.write")} isPlatformAdmin={user.permissions.includes("platform.admin")}
        gateways={gatewayConfigured()} rates={rates} exchange={exchange.map((e) => ({ currency: e.currency, paisePerUnit: e.paisePerUnit, updatedAt: e.updatedAt.toISOString() }))}
        usage={usage} balances={balances} gatewayStatus={staff ? gatewayStatus(base) : undefined}
        ledger={data.ledger.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() }))} payments={data.payments.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() }))}
      />
    </>
  );
}
