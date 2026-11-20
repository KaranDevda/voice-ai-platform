import Link from "next/link";
import { currentLang } from "@/lib/i18n-server";
import { listLedger } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { T } from "@/components/t";

const REASONS: Record<string, string> = { topup: "Top-up", usage_call: "AI call", usage_sms: "Text", adjustment: "Adjustment", refund: "Refund" };
const rupees = (paise: number) => `${paise < 0 ? "-" : ""}Rs ${(Math.abs(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const PAGE = 50;

/** The full credit history with a kind and date filter, paging, and a CSV download of whatever the filter shows. */
export default async function BillingHistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const lang = await currentLang();
  const user = await requirePageUser();
  const q = await searchParams;
  const reason = q.reason && REASONS[q.reason] ? q.reason : "";
  const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  const from = day(q.from), to = day(q.to), page = Math.max(1, Number(q.page) || 1);
  const data = await allowed(() => listLedger(getDb(), user, {
    reason: reason || undefined, from: from ? new Date(`${from}T00:00:00+05:30`) : undefined, to: to ? new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86_400_000) : undefined,
    limit: PAGE, offset: (page - 1) * PAGE,
  }));
  if (!data) return <Forbidden />;
  const pages = Math.max(1, Math.ceil(data.total / PAGE));
  const link = (p: number) => `/billing/history?${new URLSearchParams({ ...(reason ? { reason } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), page: String(p) })}`;
  const csv = `/api/billing/export?${new URLSearchParams({ ...(reason ? { reason } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) })}`;
  return (
    <>
      <PageHeader title="Credit history" description="Every change to your balance: top-ups, AI calls, texts, adjustments and refunds." />
      <Card>
        <CardHeader title={`${formatNumber(data.total, lang)} ${data.total === 1 ? "entry" : "entries"}`} action={<a href={csv} className="text-sm text-primary underline"><T>Download CSV</T></a>} />
        <CardBody className="grid gap-4">
          <form className="flex flex-wrap items-end gap-3" action="/billing/history">
            <label className="grid gap-1 text-sm"><T>Kind</T><select name="reason" defaultValue={reason} className="h-9 rounded-md border border-border bg-background px-2"><option value=""><T>All</T></option>{Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="grid gap-1 text-sm"><T>From</T><input type="date" name="from" defaultValue={from} className="h-9 rounded-md border border-border bg-background px-2" /></label>
            <label className="grid gap-1 text-sm"><T>To</T><input type="date" name="to" defaultValue={to} className="h-9 rounded-md border border-border bg-background px-2" /></label>
            <button type="submit" className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"><T>Filter</T></button>
            <Link href="/billing/history" className="pb-2 text-sm text-muted-foreground underline"><T>Clear</T></Link>
          </form>
          {data.rows.length === 0 ? <p className="text-sm text-muted-foreground"><T>Nothing matches.</T></p> : (
            <Table><thead><tr><Th>When</Th><Th>What</Th><Th>Change</Th><Th>Country</Th><Th>Note</Th></tr></thead>
              <tbody>{data.rows.map((l) => <Tr key={l.id}><Td>{formatDateTime(l.createdAt.toISOString(), lang)}</Td><Td>{REASONS[l.reason] ?? l.reason}</Td><Td className={l.deltaPaise < 0 ? "text-danger" : "text-success"}>{rupees(l.deltaPaise)}</Td><Td>{l.country ?? ""}</Td><Td className="text-muted-foreground">{l.note ?? ""}</Td></Tr>)}</tbody></Table>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground"><T>Page</T> {page} <T>of</T> {pages}</span>
            <span className="flex gap-3">{page > 1 && <Link href={link(page - 1)} className="underline"><T>Newer</T></Link>}{page < pages && <Link href={link(page + 1)} className="underline"><T>Older</T></Link>}</span>
          </div>
          <Link href="/billing" className="text-sm underline"><T>Back to Billing</T></Link>
        </CardBody>
      </Card>
    </>
  );
}
