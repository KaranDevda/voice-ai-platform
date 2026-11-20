"use client";
import { useEffect, useState, type FormEvent } from "react";
import { formatDateTime } from "@/lib/utils";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Select } from "./ui/form";
import { T, useLang, useT } from "./t";

interface ApiTokenRow {
  id: string; name: string; prefix: string; permissions: string[]; expiresAt: string | null;
  lastUsedAt: string | null; revokedAt: string | null; createdAt: string;
}
const label = (permission: string) => permission.replaceAll(".", " · ").replaceAll("_", " ");
const when = (value: string | null, lang: string, never: string) => value ? formatDateTime(value, lang) : never;

/** Creates narrowly-scoped credentials; the raw secret is shown once and cannot be retrieved later. */
export function ApiTokenManager({ availablePermissions }: { availablePermissions: string[] }) {
  const lang = useLang();
  const t = useT();
  const permissions = [...new Set(availablePermissions.filter((p) => p !== "platform.admin"))].sort();
  const [rows, setRows] = useState<ApiTokenRow[]>([]);
  const [name, setName] = useState("");
  const [days, setDays] = useState(90);
  const [selected, setSelected] = useState<string[]>([]);
  const [newToken, setNewToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function refresh() {
    const res = await fetch("/api/account/api-tokens", { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setRows(body as ApiTokenRow[]);
    else setError("Could not load your API tokens.");
  }
  useEffect(() => { void refresh(); }, []);

  function toggle(permission: string) {
    setSelected((current) => current.includes(permission) ? current.filter((p) => p !== permission) : [...current, permission]);
  }

  async function create(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); setNewToken(""); setCopied(false);
    const res = await fetch("/api/account/api-tokens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, permissions: selected, expiresInDays: days }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { setError(body.message ?? body.issues?.[0]?.message ?? "Could not create the token."); return; }
    setNewToken(body.token); setName(""); setSelected([]); await refresh();
  }

  async function revoke(token: ApiTokenRow) {
    if (!confirm(`Revoke “${token.name}”? Applications using it will stop authenticating immediately.`)) return;
    const res = await fetch(`/api/account/api-tokens/${token.id}`, { method: "DELETE" });
    if (!res.ok) setError("Could not revoke the token.");
    else await refresh();
  }

  return <Card>
    <CardHeader title="API tokens" description="Create a limited API credential for your integrations. The full token is shown once; save it somewhere secure." />
    <CardBody className="grid gap-5">
      {permissions.length === 0 ? <p className="text-sm text-muted-foreground"><T>Your role has no API permissions available to grant.</T></p> : <form onSubmit={create} className="grid gap-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Token name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required placeholder="Reporting integration" /></Field>
          <Field label="Expires after"><Select value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={30}><T>30 days</T></option><option value={90}><T>90 days</T></option><option value={180}><T>180 days</T></option><option value={365}><T>365 days</T></option></Select></Field>
        </div>
        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium"><T>Permissions (</T>{selected.length} <T>selected)</T></legend>
          <div className="grid max-h-60 gap-x-4 gap-y-2 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">
            {permissions.map((permission) => <label key={permission} className="flex items-start gap-2 text-xs"><input type="checkbox" checked={selected.includes(permission)} onChange={() => toggle(permission)} /><span>{label(permission)}</span></label>)}
          </div>
        </fieldset>
        {error && <p role="alert" className="text-sm text-danger"><T>{error}</T></p>}
        <div><Button type="submit" disabled={busy || !name.trim() || selected.length === 0}>{busy ? "Creating…" : "Create API token"}</Button></div>
      </form>}

      {newToken && <div className="grid gap-2 rounded-md border border-warning p-3" role="status">
        <p className="text-sm font-medium"><T>Copy this token now. It cannot be shown again.</T></p>
        <code className="break-all rounded bg-muted p-2 text-xs">{newToken}</code>
        <div><Button type="button" variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(newToken).then(() => setCopied(true), () => setError("Clipboard access failed; select and copy the token manually.")); }}>{copied ? "Copied" : "Copy token"}</Button></div>
      </div>}

      {rows.length > 0 && <div className="grid gap-2">
        <h3 className="text-sm font-medium"><T>Your credentials</T></h3>
        {rows.map((token) => <div key={token.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border p-3 text-sm">
          <div className="min-w-0"><div className="font-medium">{token.name} <code className="font-normal text-muted-foreground">{token.prefix}…</code></div>
            <p className="mt-1 text-xs text-muted-foreground">{token.permissions.map(label).join(", ")} <T>· expires</T> {when(token.expiresAt, lang, t("Never"))} <T>· last used</T> {when(token.lastUsedAt, lang, t("Never"))}</p>
            {token.revokedAt && <p className="mt-1 text-xs text-danger"><T>Revoked</T> {when(token.revokedAt, lang, t("Never"))}</p>}
          </div>
          {!token.revokedAt && <Button type="button" size="sm" variant="outline" onClick={() => void revoke(token)}>Revoke</Button>}
        </div>)}
      </div>}
    </CardBody>
  </Card>;
}
