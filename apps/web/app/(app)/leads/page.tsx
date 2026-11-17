import { listLeads } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { LeadsBulkTable } from "@/components/leads-bulk-table";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";

export default async function LeadsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string; heat?: string; sort?: string; tag?: string; consent?: string; dnd?: string }> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const data = await allowed(() => listLeads(getDb(), user, { q: sp.q, status: sp.status, heat: sp.heat, sort: sp.sort, tag: sp.tag, consent: sp.consent, dnd: sp.dnd, page: Number(sp.page) || 1 }));
  if (!data) return <Forbidden />;
  return (
    <LeadsBulkTable
      canExport={user.permissions.some((p) => p.startsWith("leads.export."))}
      exportFilters={{ q: sp.q, status: sp.status, heat: sp.heat, sort: sp.sort, tag: sp.tag, consent: sp.consent, dnd: sp.dnd }}
      rows={data.rows as any}
      total={data.total} page={data.page} hasMore={data.hasMore}
      q={sp.q} status={sp.status} heat={sp.heat} sort={sp.sort} tag={sp.tag} consent={sp.consent} dnd={sp.dnd}
    />
  );
}
