"use client";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { T } from "./t";

const LANGUAGES = ["en", "hi", "ar", "bn", "te", "mr", "ta", "ur", "gu", "kn"] as const;

export function ExtraLanguagesForm({ extras }: { extras: Array<{ code: string; name: string; nativeName: string; rtl: boolean; enabled: boolean }> }) {
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = { code: fd.get("code"), name: fd.get("name"), nativeName: fd.get("nativeName"), rtl: fd.get("rtl") === "on" };
    setBusy((b) => new Set([...b, "add"]));
    try {
      const res = await fetch("/api/translations/extras", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setNote(`Could not add language: ${b.message ?? (b.issues ? b.issues.map((i: { path: unknown[]; message: string }) => `${i.path.join(".")} ${i.message}`).join("; ") : b.error) ?? "error"} (HTTP ${res.status})`); return; }
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

  async function removeLang(code: string, name: string) {
    if (!confirm(`Delete ${name} (${code}) and all of its text overrides? This cannot be undone.`)) return;
    setBusy((b) => new Set([...b, code]));
    try {
      const res = await fetch(`/api/translations/extras/${code}`, { method: "DELETE" });
      if (res.ok) window.location.reload();
      else { const b = await res.json().catch(() => ({})); setNote(`Could not delete language: ${b.message ?? b.error ?? "error"} (HTTP ${res.status})`); }
    } finally { setBusy((b) => new Set([...b].filter((x) => x !== code))); }
  }

  return (
    <>
      <form onSubmit={add} className="mb-6 grid gap-3 sm:grid-cols-4 lg:grid-cols-6 items-end">
        <Input name="code" placeholder="Code (e.g. fr)" required maxLength={5} aria-label="Language code" />
        <Input name="name" placeholder="English name (e.g. French)" required aria-label="English name" />
        <Input name="nativeName" placeholder="Native name (e.g. Français)" required aria-label="Native name" />
        <label className="flex items-center gap-2 cursor-pointer"><input name="rtl" type="checkbox" /> <T>RTL</T></label>
        <div className="sm:col-span-4 lg:col-span-6 flex items-center gap-2">
          <Button type="submit" disabled={busy.has("add")}>{busy.has("add") ? "Adding…" : "Add language"}</Button>
          {note && <span className="text-sm text-success"><T>{note}</T></span>}
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
              <Td className="text-end"><Button size="sm" variant="outline" onClick={() => removeLang(l.code, l.name)} disabled={busy.has(l.code)}>Delete</Button></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

export function OverridesTable({ overrides }: { overrides: Array<{ key: string; language: string; value: string }> }) {
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");

  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = { key: fd.get("key"), language: fd.get("language"), value: fd.get("value") };
    setBusy((b) => new Set([...b, "add"]));
    try {
      const res = await fetch("/api/translations/overrides", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const b = await res.json().catch(() => ({})); setNote(`Could not add override: ${b.message ?? (b.issues ? b.issues.map((i: { path: unknown[]; message: string }) => `${i.path.join(".")} ${i.message}`).join("; ") : b.error) ?? "error"} (HTTP ${res.status})`); return; }
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
          <option value=""><T>Language</T></option>
          {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
        </Select>
        <Input name="value" placeholder="Override value" required aria-label="Override value" className="sm:col-span-2" />
        <Button type="submit" disabled={busy.has("add")} className="sm:col-span-4 lg:col-span-2">{busy.has("add") ? "Adding…" : "Add override"}</Button>
        {note && <span className="sm:col-span-4 lg:col-span-2 text-sm text-success"><T>{note}</T></span>}
      </form>
      <Table>
        <thead><tr><Th>Key</Th><Th>Language</Th><Th>Value</Th><Th> </Th></tr></thead>
        <tbody>
          {overrides.length === 0 ? <Tr><Td colSpan={4} className="text-center py-8 text-muted-foreground"><T>No overrides yet.</T></Td></Tr> : overrides.map((o) => (
            <Tr key={`${o.key}|${o.language}`}>
              <Td className="font-mono text-sm">{o.key}</Td>
              <Td><Badge>{o.language}</Badge></Td>
              <Td className="max-w-[300px] truncate" title={o.value}>{o.value}</Td>
              <Td className="text-end"><Button size="sm" variant="outline" onClick={() => remove(o.key, o.language)} disabled={busy.has(`${o.key}|${o.language}`)}>Delete</Button></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}