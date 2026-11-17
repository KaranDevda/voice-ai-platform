import { createCronJob, listCronJobs, deleteCronJob } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
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
import { useState } from "react";

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

function ScheduledExportsForm() {
  "use client";

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = {
      name: fd.get("name"),
      reportType: fd.get("reportType"),
      cron: fd.get("cron"),
      timezone: fd.get("timezone") || "Asia/Kolkata",
      email: fd.get("email"),
    };
    setBusy(true); setNote("");
    try {
      const res = await fetch("/api/scheduled-exports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) { setNote(b.message ?? "Could not create schedule"); return; }
      setNote(`Created “${body.name}” (${body.cron}).`);
      (e.target as HTMLFormElement).reset();
      window.location.reload();
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={create} className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end">
      <Input name="name" placeholder="Schedule name" required aria-label="Schedule name" />
      <Select name="reportType" required aria-label="Report type">
        <option value="">Report type</option>
        {REPORT_TYPES.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
      </Select>
      <Select name="cron" required aria-label="Cron schedule">
        <option value="">When</option>
        {CRON_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        <option value="custom">Custom cron…</option>
      </Select>
      <Input name="timezone" placeholder="Timezone (default Asia/Kolkata)" defaultValue="Asia/Kolkata" />
      <Input name="email" type="email" placeholder="Delivery email (optional)" />
      <div className="sm:col-span-2 lg:col-span-5 flex items-center gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create schedule"}</Button>
        {note && <span className="text-sm text-success">{note}</span>}
      </div>
    </form>
  );
}

function ScheduledExportsTable() {
  "use client";

  const [rows, setRows] = useState<Array<{ id: string; name: string; reportType: string; cron: string; nextRun: string; active: boolean }>>([]);
  const [busy, setBusy] = useState<Set<string>>(new Set());

  async function load() {
    const res = await fetch("/api/scheduled-exports");
    if (res.ok) setRows(await res.json());
  }

  async function toggleActive(id: string, active: boolean) {
    setBusy((b: Set<string>) => new Set([...b, id]));
    try {
      const res = await fetch(`/api/scheduled-exports/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: !active }) });
      if (res.ok) load();
    } finally { setBusy((b: Set<string>) => new Set([...b].filter((x) => x !== id))); }
  }

  async function remove(id: string) {
    if (!confirm("Delete this scheduled export?")) return;
    setBusy((b: Set<string>) => new Set([...b, id]));
    try {
      const res = await fetch(`/api/scheduled-exports/${id}`, { method: "DELETE" });
      if (res.ok) load();
    } finally { setBusy((b: Set<string>) => new Set([...b].filter((x) => x !== id))); }
  }

  return (
    <>
      <Table>
        <thead><tr><Th>Name</Th><Th>Report</Th><Th>Cron</Th><Th>Next run</Th><Th>Status</Th><Th> </Th></tr></thead>
        <tbody>
          {rows.length === 0 ? <Tr><Td colSpan={6} className="text-center py-8 text-muted-foreground">No scheduled exports yet. Create one above.</Td></Tr> : rows.map((r: { id: string; name: string; reportType: string; cron: string; nextRun: string; active: boolean }) => (
            <Tr key={r.id}>
              <Td className="font-medium">{r.name}</Td>
              <Td>{REPORT_TYPES.find((t) => t.key === r.reportType)?.name ?? r.reportType}</Td>
              <Td className="font-mono text-sm">{r.cron}</Td>
              <Td>{r.nextRun ? formatDateTime(r.nextRun) : "—"}</Td>
              <Td><Badge tone={r.active ? "success" : "neutral"}>{r.active ? "Active" : "Paused"}</Badge></Td>
              <Td className="text-right">
                <Button size="sm" variant="outline" onClick={() => toggleActive(r.id, r.active)} disabled={busy.has(r.id)}>{r.active ? "Pause" : "Resume"}</Button>{" "}
                <Button size="sm" variant="outline" onClick={() => remove(r.id)} disabled={busy.has(r.id)}>Delete</Button>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}