import { listAppErrors } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Pager } from "@/components/ui/page";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { formatDateTime, titleCase } from "@/lib/utils";

export default async function ErrorsPage({ searchParams }: { searchParams: Promise<{ page?: string; route?: string }> }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const data = await allowed(() => listAppErrors(getDb(), user, { page: Number(sp.page) || 1, route: sp.route }));
  if (!data) return <Forbidden />;
  return (
    <>
      <PageHeader title="Application errors" description="Unhandled errors captured from API routes and the client. Use the route filter to narrow down." />
      <Card>
        <CardHeader title="Errors" description={data.rows.length === 0 ? "No errors logged yet" : `${data.rows.length} error${data.rows.length === 1 ? "" : "s"} in this page`} />
        <CardBody>
          <form action="/errors" className="mb-4 flex items-center gap-2">
            <input name="route" defaultValue={sp.route ?? ""} placeholder="Filter by route (e.g. /api/calls)" className="h-9 rounded-md border border-border px-3 text-sm w-full sm:w-64" aria-label="Route filter" />
            <Button type="submit" size="sm">Filter</Button>
            {sp.route && <a href="/errors" className="text-sm text-muted-foreground hover:underline">Clear</a>}
          </form>
          {data.rows.length === 0 ? (
            <EmptyState title="No errors" description="Errors from API routes and the client will appear here." />
          ) : (
            <Table>
              <thead><tr><Th>When</Th><Th>Route</Th><Th>Method</Th><Th>Message</Th><Th className="text-end">Stack</Th></tr></thead>
              <tbody>
                {data.rows.map((e) => (
                  <Tr key={e.id}>
                    <Td>{formatDateTime(e.at)}</Td>
                    <Td className="font-mono text-sm">{e.route}</Td>
                    <Td className="text-xs uppercase">{e.method ?? "—"}</Td>
                    <Td className="max-w-[300px] truncate" title={e.errorMessage}>{e.errorMessage}</Td>
                    <Td className="text-end">
                      {e.errorStack && (
                        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(e.errorStack!); alert("Stack trace copied"); }}>Copy stack</Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          <Pager basePath="/errors" params={{ route: sp.route }} page={data.page} hasMore={data.hasMore} />
        </CardBody>
      </Card>
    </>
  );
}