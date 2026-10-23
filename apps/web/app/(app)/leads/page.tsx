import Link from "next/link";
import { listLeads } from "@voiceai/db";
import { LEAD_STATUSES } from "@voiceai/shared";
import { FilterBar } from "@/components/filter-bar";
import { Forbidden } from "@/components/forbidden";
import { Badge, LeadStatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, Pager } from "@/components/ui/page";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { formatDateTime, titleCase } from "@/lib/utils";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const data = await allowed(() => listLeads(getDb(), user, { q: sp.q, status: sp.status, page: Number(sp.page) || 1 }));
  if (!data) return <Forbidden />;

  return (
    <>
      <PageHeader title="Leads" description="Every caller and prospect, linked to their calls." />
      <Card>
        <FilterBar action="/leads" q={sp.q} selects={[{ name: "status", value: sp.status, label: "All statuses", options: LEAD_STATUSES.map((s) => [s, titleCase(s)]) }]} />
        {data.rows.length === 0 ? (
          <EmptyState title="No leads match" description="Try clearing the filters." />
        ) : (
          <Table>
            <thead><tr><Th>Lead</Th><Th>Status</Th><Th>Score</Th><Th>Source</Th><Th>Owner</Th><Th>Calls</Th><Th>Last call</Th></tr></thead>
            <tbody>
              {data.rows.map((l) => (
                <Tr key={l.id}>
                  <Td>
                    <Link href={`/leads/${l.id}`} className="font-medium text-primary hover:underline">{l.name ?? "Unknown caller"}</Link>
                    <div className="text-xs text-muted-foreground">{l.phone}</div>
                  </Td>
                  <Td><div className="flex items-center gap-1.5"><LeadStatusBadge status={l.status} />{l.dnd && <Badge tone="danger">DND</Badge>}</div></Td>
                  <Td className="tabular-nums">{l.score ?? "—"}</Td>
                  <Td>{l.source ?? "—"}</Td>
                  <Td>{l.ownerEmail ?? <span className="text-muted-foreground">Unassigned</span>}</Td>
                  <Td className="tabular-nums">{l.callCount}</Td>
                  <Td>{l.lastCallAt ? formatDateTime(l.lastCallAt) : "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager basePath="/leads" params={{ q: sp.q, status: sp.status }} page={data.page} hasMore={data.hasMore} />
      </Card>
    </>
  );
}
