import { createCronJob, listCronJobs, deleteCronJob } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { ScheduledExportsForm, ScheduledExportsTable } from "@/components/scheduled-exports-admin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, Pager } from "@/components/ui/page";
import { Input, Select } from "@/components/ui/form";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { formatDateTime, titleCase } from "@/lib/utils";

const REPORT_TYPES = [
  { key: "contacts", name: "Contacts", href: "/api/contacts/export" },
  { key: "calls", name: "Call logs", href: "/api/reports/export/calls" },
  { key: "sms", name: "SMS messages", href: "/api/reports/export/sms" },
];

const CRON_PRESETS = [
  { label: "Daily 02:00", value: "0 2 * * *" },
  { label: "Weekly Mon 02:00", value: "0 2 * * 1" },
  { label: "Monthly 1st 02:00", value: "0 2 1 * *" },
];

export default async function ScheduledExportsPage() {
  const user = await requirePageUser();
  if (!user.permissions.some((p) => p.startsWith("leads.export."))) return <Forbidden />;
  return (
    <>
      <PageHeader title="Scheduled exports" description="Create recurring CSV exports delivered to your inbox or storage. Each run is audited." actions={<ScheduledExportsForm />} />
      <Card>
        <CardHeader title="Active schedules" description="Edit or delete existing scheduled exports." />
        <CardBody>
          <ScheduledExportsTable />
        </CardBody>
      </Card>
    </>
  );
}
