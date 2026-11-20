import Link from "next/link";
import { Forbidden } from "@/components/forbidden";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { formatDateTime } from "@/lib/utils";
import { T } from "@/components/t";

const REPORTS: Array<{ key: string; name: string; description: string; href: string; permission: string }> = [
  { key: "contacts", name: "Contacts", description: "All leads you can see, with tags, consent, DND and custom fields.", href: "/api/contacts/export", permission: "leads.export" },
  { key: "calls", name: "Call logs", description: "Every call, outcome, duration, lead and agent.", href: "/api/reports/export/calls", permission: "leads.export" },
  { key: "sms", name: "SMS messages", description: "Every queued, sent, failed and received text.", href: "/api/reports/export/sms", permission: "leads.export" },
];

export default async function ReportsExportPage() {
  const user = await requirePageUser();
  const can = (p: string) => user.permissions.includes(p) || user.permissions.some((x) => x.startsWith(p.split(".")[0] + ".") && x.endsWith(".all"));
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold"><T>Export reports</T></h1>
        <p className="text-sm text-muted-foreground"><T>Download CSV extracts of your organisation's data. Each export is audited.</T></p>
      </div>
      <Card>
        <CardHeader title="Available exports" />
        <CardBody>
          <Table>
            <thead><tr><Th>Report</Th><Th>What's included</Th><Th> </Th></tr></thead>
            <tbody>
              {REPORTS.map((r) => {
                const ok = can(r.permission);
                return (
                  <Tr key={r.key}>
                    <Td className="font-medium">{r.name}</Td>
                    <Td className="text-sm text-muted-foreground">{r.description}</Td>
                    <Td className="text-end">
                      {ok ? (
                        <Link href={r.href}><Button size="sm">Download CSV</Button></Link>
                      ) : (
                        <Button size="sm" variant="outline" disabled>No access</Button>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </>
  );
}
