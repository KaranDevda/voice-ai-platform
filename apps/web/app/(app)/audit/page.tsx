import { listAudit } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Pager } from "@/components/ui/page";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { formatDateTime } from "@/lib/utils";

const GROUPS: Array<[string, string]> = [["login", "Logins"], ["recording", "Recording plays"], ["voice_profile", "Voice profiles"], ["consent", "Consents"], ["device", "Devices"], ["org_settings", "Settings"], ["mfa", "2FA"]];
const tone = (a: string) => (a.includes("failed") || a.includes("revoke") ? "danger" : a.startsWith("recording") ? "warning" : "neutral");

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; page?: string }> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const data = await allowed(() => listAudit(getDb(), user, { action: sp.action, page: Number(sp.page) || 1 }));
  if (!data) return <Forbidden />;

  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of sensitive actions. Entries cannot be edited or deleted." />
      <Card>
        <form action="/audit" className="flex items-center gap-2 border-b border-border px-5 py-3">
          <select name="action" defaultValue={sp.action ?? ""} aria-label="Action type" className="h-9 rounded-lg border border-border bg-card px-3 text-sm">
            <option value="">All actions</option>
            {GROUPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button className="h-9 rounded-lg bg-primary-soft px-4 text-sm font-medium text-primary" type="submit">Apply</button>
        </form>
        {data.rows.length === 0 ? (
          <EmptyState title="No entries" />
        ) : (
          <Table>
            <thead><tr><Th>When</Th><Th>Who</Th><Th>Action</Th><Th>Record</Th><Th>IP</Th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <Tr key={r.id}>
                  <Td>{formatDateTime(r.at)}</Td><Td>{r.actorEmail ?? "System"}</Td>
                  <Td><Badge tone={tone(r.action)}>{r.action}</Badge></Td>
                  <Td className="text-muted-foreground">{r.entity}{r.entityId ? ` · ${r.entityId.slice(0, 8)}` : ""}</Td>
                  <Td className="text-muted-foreground">{r.ip ?? "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager basePath="/audit" params={{ action: sp.action }} page={data.page} hasMore={data.hasMore} />
      </Card>
    </>
  );
}
