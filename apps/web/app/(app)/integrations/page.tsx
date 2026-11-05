import { listIntegrations, listWidgets } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { IntegrationsPanel } from "@/components/integrations-panel";
import { WidgetsPanel } from "@/components/widgets-panel";
import { PageHeader } from "@/components/ui/page";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

export default async function IntegrationsPage() {
  const user = await requirePageUser();
  const data = await allowed(() => listIntegrations(getDb(), user));
  if (!data) return <Forbidden />;
  const widgets = await listWidgets(getDb(), user);
  return (
    <>
      <PageHeader title="CRM integrations" description="Send calls, call summaries and lead changes to your CRM or any tool, as signed web requests. Failures are retried automatically." />
      <IntegrationsPanel
        canEdit={user.permissions.includes("org_settings.write")} events={data.events}
        endpoints={data.endpoints.map((e) => ({ ...e, createdAt: e.createdAt.toISOString(), lastDeliveredAt: e.lastDeliveredAt ? new Date(e.lastDeliveredAt).toISOString() : null }))}
        deliveries={data.deliveries.map((d) => ({ ...d, nextAttemptAt: d.nextAttemptAt.toISOString(), createdAt: d.createdAt.toISOString() }))}
      />
      <h2 className="mb-3 mt-10 text-lg font-semibold tracking-tight">Website voice widget</h2>
      <WidgetsPanel canEdit={user.permissions.includes("org_settings.write") && user.permissions.includes("studio.use")} widgets={widgets.map((w) => ({ ...w, createdAt: undefined }))} />
    </>
  );
}
