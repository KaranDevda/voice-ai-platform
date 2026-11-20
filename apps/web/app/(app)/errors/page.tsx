import { listAppErrors } from "@voiceai/db";
import { currentLang } from "@/lib/i18n-server";
import { ResolveButton } from "@/components/resolve-button";
import { CopyButton } from "@/components/copy-button";
import { Forbidden } from "@/components/forbidden";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Pager } from "@/components/ui/page";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { formatDateTime, titleCase } from "@/lib/utils";
import { T } from "@/components/t";

export default async function ErrorsPage({ searchParams }: { searchParams: Promise<{ page?: string; route?: string; status?: string }> }) {
  const lang = await currentLang();
  const user = await requirePageUser();
  const sp = await searchParams;
  const status = sp.status === "resolved" || sp.status === "all" ? sp.status : "open";
  const data = await allowed(() => listAppErrors(getDb(), user, { page: Number(sp.page) || 1, route: sp.route, status }));
  if (!data) return <Forbidden />;
  return (
    <>
      <PageHeader title="Application errors" description="Unhandled errors captured from API routes and the client. Use the route filter to narrow down." />
      <Card>
        <CardHeader title="Errors" description={data.rows.length === 0 ? "No errors logged yet" : `${data.rows.length} error${data.rows.length === 1 ? "" : "s"} in this page`} />
        <CardBody>
          <div className="mb-3 flex gap-2 text-sm">
            {(["open", "resolved", "all"] as const).map((s2) => (
              <a key={s2} href={`/errors?status=${s2}${sp.route ? `&route=${encodeURIComponent(sp.route)}` : ""}`} className={status === s2 ? "rounded-md bg-primary-soft px-3 py-1 font-medium text-primary" : "rounded-md px-3 py-1 text-muted-foreground hover:bg-muted"}>{titleCase(s2)}</a>
            ))}
          </div>
          <form action="/errors" className="mb-4 flex items-center gap-2">
            <input type="hidden" name="status" value={status} />
            <input name="route" defaultValue={sp.route ?? ""} placeholder="Filter by route (e.g. /api/calls)" className="h-9 rounded-md border border-border px-3 text-sm w-full sm:w-64" aria-label="Route filter" />
            <Button type="submit" size="sm">Filter</Button>
            {sp.route && <a href="/errors" className="text-sm text-muted-foreground hover:underline"><T>Clear</T></a>}
          </form>
          {data.rows.length === 0 ? (
            <EmptyState title={status === "open" ? "No open errors" : "No errors"} description="Errors from API routes and the client will appear here." />
          ) : (
            <Table>
              <thead><tr><Th>When</Th><Th>Route</Th><Th>Method</Th><Th>Message</Th><Th className="text-end">Actions</Th></tr></thead>
              <tbody>
                {data.rows.map((e) => (
                  <Tr key={e.id}>
                    <Td>{formatDateTime(e.at, lang)}</Td>
                    <Td className="font-mono text-sm">{e.route}</Td>
                    <Td className="text-xs uppercase">{e.method ?? "—"}</Td>
                    <Td className="max-w-[300px] truncate" title={e.errorMessage}>{e.errorMessage}</Td>
                    <Td className="text-end"><div className="flex justify-end gap-2">
                      {e.errorStack && <CopyButton text={e.errorStack} label="Copy stack" />}
                      <ResolveButton id={e.id} resolved={!!e.resolvedAt} />
                    </div></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          <Pager basePath="/errors" params={{ route: sp.route, status }} page={data.page} hasMore={data.hasMore} />
        </CardBody>
      </Card>
    </>
  );
}