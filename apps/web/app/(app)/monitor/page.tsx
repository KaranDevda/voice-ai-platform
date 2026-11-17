import { listMonitorCalls } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { PageHeader } from "@/components/ui/page-header";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { ListenIn } from "@/components/listen-in";
import { MonitorTable } from "./monitor-table";

export default async function MonitorPage() {
  const user = await requirePageUser();
  const data = await allowed(() => listMonitorCalls(getDb(), user, 50));
  if (!data) return <Forbidden />;
  const rows = (data.rows ?? []).map((r) => ({
    ...r,
    startedAt: r.startedAt instanceof Date ? r.startedAt.toISOString() : String(r.startedAt),
  }));
  return (
    <>
      <PageHeader
        title="Live call monitor"
        description="Recent calls with turn-by-turn transcripts. Real carrier calls appear once a Plivo number is configured and calls are live."
      />
      <ListenIn />
      <MonitorTable rows={rows} aggregateOnly={data.aggregateOnly ?? false} />
    </>
  );
}
