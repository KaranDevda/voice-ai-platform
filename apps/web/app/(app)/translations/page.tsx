import { listExtraLanguagesOrg, listTranslationOverridesOrg, upsertTranslationOverride, deleteTranslationOverride } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Input, Textarea, Select } from "@/components/ui/form";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

const LANGUAGES = ["en", "hi", "ar", "bn", "te", "mr", "ta", "ur", "gu", "kn"] as const;

export default async function TranslationsPage() {
  const user = await requirePageUser();
  if (!user.permissions.includes("platform.admin")) return <Forbidden />;
  const [extras, overrides] = await Promise.all([
    allowed(() => listExtraLanguagesOrg(getDb(), user)),
    allowed(() => listTranslationOverridesOrg(getDb(), user)),
  ]);
  if (!extras || !overrides) return <Forbidden />;
  const extrasData = extras as Array<{ code: string; name: string; nativeName: string; rtl: boolean; enabled: boolean }>;
  const overridesData = overrides as Array<{ key: string; language: string; value: string }>;
  return (
    <>
      <PageHeader title="Translations & RTL" description="Manage extra languages and per-language string overrides. RTL is automatic for Arabic/Urdu." />
      <Card>
        <CardHeader title="Extra languages" description="Enabled languages appear in the user's language selector." />
        <CardBody>
          <ExtraLanguagesForm extras={extrasData} />
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title="String overrides" description="Override any UI string for a specific language. Use the key from the translation dictionary." />
        <CardBody>
          <OverridesTable overrides={overridesData} />
        </CardBody>
      </Card>
    </>
  );
}

function ExtraLanguagesForm({ extras }: { extras: Array<{ code: string; name: string; nativeName: string; rtl: boolean; enabled: boolean }> }) {
  "use client";
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = { code: fd.get("code"), name: fd.get("name"), nativeName: fd.get("nativeName"), rtl: fd.get("rtl") === "on" };
    setBusy((b) => new Set([...b, "add"]));
    try {
      const res = await fetch("/api/translations/extras", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setNote(b.message ?? "Could not add language"); return; }
      setNote("Language added. Reload to see it.");
      (e.target as HTMLFormElement).reset();
      window.location.reload();
    } finally { setBusy((b) => new Set([...b].filter((x) => x !== "add"))); }
  }

  async function toggle(code: string, enabled: boolean) {
    setBusy((b) => new Set([...b, code]));
    try {
      const res = await fetch(`/api/translations/extras/${code}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !enabled }) });
      if (res.ok) window.location.reload();
    } finally { setBusy((b) => new Set([...b].filter((x) => x !== code))); }
  }

  return (
    <>
      <form onSubmit={add} className="mb-6 grid gap-3 sm:grid-cols-4 lg:grid-cols-6 items-end">
        <Input name="code" placeholder="Code (e.g. fr)" required maxLength={5} aria-label="Language code" />
        <Input name="name" placeholder="English name (e.g. French)" required aria-label="English name" />
        <Input name="nativeName" placeholder="Native name (e.g. Français)" required aria-label="Native name" />
        <label className="flex items-center gap-2 cursor-pointer"><input name="rtl" type="checkbox" /> RTL</label>
        <div className="sm:col-span-4 lg:col-span-6 flex items-center gap-2">
          <Button type="submit" disabled={busy.has("add")}>{busy.has("add") ? "Adding…" : "Add language"}</Button>
          {note && <span className="text-sm text-success">{note}</span>}
        </div>
      </form>
      <Table>
        <thead><tr><Th>Code</Th><Th>Name</Th><Th>Native</Th><Th>RTL</Th><Th>Enabled</Th><Th> </Th></tr></thead>
        <tbody>
          {extras.map((l) => (
            <Tr key={l.code}>
              <Td className="font-mono">{l.code}</Td>
              <Td>{l.name}</Td>
              <Td>{l.nativeName}</Td>
              <Td className="text-center">{l.rtl ? <Badge tone="success">RTL</Badge> : <Badge tone="neutral">LTR</Badge>}</Td>
              <Td className="text-center"><Button size="sm" variant="outline" onClick={() => toggle(l.code, l.enabled)} disabled={busy.has(l.code)}>{l.enabled ? "Disable" : "Enable"}</Button></Td>
              <Td className="text-right"><Button size="sm" variant="outline" disabled>Delete</Button></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

function OverridesTable({ overrides }: { overrides: Array<{ key: string; language: string; value: string }> }) {
  "use client";
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = { key: fd.get("key"), language: fd.get("language"), value: fd.get("value") };
    setBusy((b) => new Set([...b, "add"]));
    try {
      const res = await fetch("/api/translations/overrides", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setNote(b.message ?? "Could not add override"); return; }
      setNote("Override added.");
      (e.target as HTMLFormElement).reset();
      window.location.reload();
    } finally { setBusy((b) => new Set([...b].filter((x) => x !== "add"))); }
  }

  async function remove(key: string, language: string) {
    if (!confirm("Delete this override?")) return;
    const id = `${key}|${language}`;
    setBusy((b) => new Set([...b, id]));
    try {
      const res = await fetch(`/api/translations/overrides/${encodeURIComponent(key)}|${language}`, { method: "DELETE" });
      if (res.ok) window.location.reload();
    } finally { setBusy((b) => new Set([...b].filter((x) => x !== id))); }
  }

  return (
    <>
      <form onSubmit={add} className="mb-6 grid gap-3 sm:grid-cols-4 items-end">
        <Input name="key" placeholder="Translation key (e.g. nav.dashboard)" required aria-label="Translation key" />
        <Select name="language" required aria-label="Language">
          <option value="">Language</option>
          {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
        </Select>
        <Input name="value" placeholder="Override value" required aria-label="Override value" className="sm:col-span-2" />
        <Button type="submit" disabled={busy.has("add")} className="sm:col-span-4 lg:col-span-2">{busy.has("add") ? "Adding…" : "Add override"}</Button>
        {note && <span className="sm:col-span-4 lg:col-span-2 text-sm text-success">{note}</span>}
      </form>
      <Table>
        <thead><tr><Th>Key</Th><Th>Language</Th><Th>Value</Th><Th> </Th></tr></thead>
        <tbody>
          {overrides.length === 0 ? <Tr><Td colSpan={4} className="text-center py-8 text-muted-foreground">No overrides yet.</Td></Tr> : overrides.map((o) => (
            <Tr key={`${o.key}|${o.language}`}>
              <Td className="font-mono text-sm">{o.key}</Td>
              <Td><Badge>{o.language}</Badge></Td>
              <Td className="max-w-[300px] truncate" title={o.value}>{o.value}</Td>
              <Td className="text-right"><Button size="sm" variant="outline" onClick={() => remove(o.key, o.language)} disabled={busy.has(`${o.key}|${o.language}`)}>Delete</Button></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}