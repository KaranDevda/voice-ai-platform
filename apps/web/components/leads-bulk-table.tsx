"use client";
import Link from "next/link";
import { useState } from "react";
import { LEAD_STATUSES, LEAD_CONSENT_STATUSES } from "@voiceai/shared";
import { ContactsImport } from "@/components/contacts-import";
import { FilterBar } from "@/components/filter-bar";
import { Badge, LeadStatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, Pager } from "@/components/ui/page";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { formatDateTime, titleCase } from "@/lib/utils";

interface LeadRow {
  id: string; name: string | null; phone: string; status: string; score: number | null;
  source: string | null; ownerEmail: string | null; callCount: number; lastCallAt: string | null;
  tags: string[]; dnd: boolean;
}

interface LeadsBulkTableProps {
  canExport: boolean;
  exportFilters: Record<string, string | undefined>;
  rows: LeadRow[];
  total: number; page: number; hasMore: boolean;
  q?: string; status?: string; heat?: string; sort?: string; tag?: string; consent?: string; dnd?: string; field?: string; history?: string;
}

function heatOf(score: number | null) {
  if (score == null) return null;
  if (score >= 70) return "hot";
  if (score >= 40) return "warm";
  return "cold";
}

export function LeadsBulkTable({ canExport, exportFilters, rows, total, page, hasMore, q, status, heat, sort, tag, consent, dnd, field, history }: LeadsBulkTableProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkNote, setBulkNote] = useState("");

  const toggleAll = (checked: boolean) => {
    if (checked) setSelected(new Set(rows.map((r) => r.id)));
    else setSelected(new Set());
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  async function bulkAct(patch: { status?: string; consent?: string; dnd?: boolean; addTags?: string[]; removeTags?: string[] }) {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBulkBusy(true); setBulkNote("");
    try {
      const res = await fetch("/api/leads/bulk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids, ...patch }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) { setBulkNote(b.message ?? "Bulk update failed"); return; }
      setBulkNote(`Updated ${b.updated ?? ids.length} contact${b.updated === 1 ? "" : "s"}.`);
      setSelected(new Set());
      window.location.reload();
    } finally { setBulkBusy(false); }
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Leads</h1>
          <p className="text-sm text-muted-foreground">Every caller and prospect, linked to their calls.</p>
        </div>
        <ContactsImport canExport={canExport} exportFilters={exportFilters} />
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">{selected.size} selected</span>{" "}
            <Button size="sm" variant="outline" onClick={() => toggleAll(false)}>Clear selection</Button>{" "}
            <Button size="sm" onClick={() => { document.getElementById("bulk-menu")?.classList.toggle("hidden"); }}>Bulk actions</Button>
            <div id="bulk-menu" className="z-50 hidden mt-2 w-56 rounded-lg border border-border bg-card p-3 shadow-lg">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2">Bulk actions</div>
              <div className="grid gap-1.5">
                <div className="grid grid-cols-2 gap-2">
                  {LEAD_STATUSES.map((s) => (
                    <Button key={s} size="sm" variant="outline" onClick={() => bulkAct({ status: s })}>{titleCase(s)}</Button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="outline" onClick={() => bulkAct({ dnd: true })}>DND on</Button>
                  <Button size="sm" variant="outline" onClick={() => bulkAct({ dnd: false })}>DND off</Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {LEAD_CONSENT_STATUSES.map((c) => (
                    <Button key={c} size="sm" variant="outline" onClick={() => bulkAct({ consent: c })}>{titleCase(c)}</Button>
                  ))}
                </div>
                <div className="pt-2 border-t border-border">
                  <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); const add = (fd.get("addTags") as string).split(/[,;]/).map((t) => t.trim()).filter(Boolean); const rem = (fd.get("removeTags") as string).split(/[,;]/).map((t) => t.trim()).filter(Boolean); void bulkAct({ addTags: add, removeTags: rem }); }} className="grid gap-2">
                    <input name="addTags" placeholder="Add tags (comma separated)" className="h-9 rounded-md border border-border px-2 text-sm" />
                    <input name="removeTags" placeholder="Remove tags" className="h-9 rounded-md border border-border px-2 text-sm" />
                    <Button size="sm" type="submit" disabled={bulkBusy}>{bulkBusy ? "Updating…" : "Apply tags"}</Button>
                  </form>
                </div>
              </div>
              {bulkNote && <p className="mt-2 text-sm text-success">{bulkNote}</p>}
            </div>
          </div>
        )}
      </div>
      <Card>
        <FilterBar action="/leads" q={q} textFilters={[{ name: "tag", value: tag, label: "Filter by exact tag", placeholder: "Tag (exact)" }, { name: "field", value: field, label: "Filter by custom field", placeholder: "Field or field=value" }]} selects={[
          { name: "status", value: status, label: "All statuses", options: LEAD_STATUSES.map((s) => [s, titleCase(s)]) },
          { name: "heat", value: heat, label: "Any score", options: [["hot", "Hot leads"], ["warm", "Warm leads"], ["cold", "Cold leads"]] },
          { name: "consent", value: consent, label: "Any consent", options: LEAD_CONSENT_STATUSES.map((s) => [s, titleCase(s)]) },
          { name: "dnd", value: dnd, label: "Any DND setting", options: [["true", "DND on"], ["false", "DND off"]] },
          { name: "history", value: history, label: "Any history", options: [["called", "Has been called"], ["texted", "Has been texted"], ["never", "Never contacted"]] },
          { name: "sort", value: sort, label: "Newest first", options: [["score", "Highest score first"]] },
        ]} />
        <p className="px-5 py-3 text-sm text-muted-foreground" role="status">
          {total.toLocaleString()} {total === 1 ? "contact matches" : "contacts match"} these filters.
        </p>
        {rows.length === 0 ? (
          <EmptyState title="No leads match" description="Try clearing the filters." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th className="w-8"><input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={(e) => toggleAll(e.target.checked)} aria-label="Select all" /></Th>
                <Th>Lead</Th><Th>Status</Th><Th>Score</Th><Th>Source</Th><Th>Owner</Th><Th>Calls</Th><Th>Last call</Th><Th className="text-end"> </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <Tr key={l.id} className="cursor-pointer" onClick={(e) => { if (!(e.target as HTMLElement).closest("input, a, button")) toggleOne(l.id); }}>
                  <Td className="w-8"><input type="checkbox" checked={selected.has(l.id)} onChange={(e) => { e.stopPropagation(); toggleOne(l.id); }} aria-label={`Select ${l.name}`} /></Td>
                  <Td>
                    <Link href={`/leads/${l.id}`} className="font-medium text-primary hover:underline block">{l.name ?? "Unknown caller"}</Link>
                    <div className="text-xs text-muted-foreground">{l.phone}</div>
                  </Td>
                  <Td><div className="flex items-center gap-1.5"><LeadStatusBadge status={l.status} />{l.dnd && <Badge tone="danger">DND</Badge>}</div></Td>
                  <Td><div className="flex items-center gap-1.5"><span className="tabular-nums">{l.score ?? "—"}</span>{heatOf(l.score) && <Badge tone={heatOf(l.score) === "hot" ? "success" : heatOf(l.score) === "warm" ? "warning" : "neutral"}>{titleCase(heatOf(l.score)!)}</Badge>}</div></Td>
                  <Td>{l.source ?? "—"}</Td>
                  <Td>{l.ownerEmail ?? <span className="text-muted-foreground">Unassigned</span>}</Td>
                  <Td className="tabular-nums">{l.callCount}</Td>
                  <Td>{l.lastCallAt ? formatDateTime(l.lastCallAt) : "—"}</Td>
                  <Td className="text-end text-muted-foreground" />
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager basePath="/leads" params={{ q, status, heat, sort, tag, consent, dnd, field, history }} page={page} hasMore={hasMore} />
      </Card>
    </>
  );
}
