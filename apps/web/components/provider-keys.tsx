"use client";
import { useCallback, useEffect, useState } from "react";
import { apiError } from "@/lib/api-client";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input } from "./ui/form";
import { useT } from "./t";

interface Key { name: string; group: string; label: string; secret: boolean; source: "website" | "server" | "missing"; hint: string | null; updatedAt: string | null }

/**
 * Platform staff set provider keys here (carrier, payment gateways, AI, KYC, e-mail) instead of editing the server's env file.
 * Values are stored encrypted, never shown again (only the last four characters), and every change needs the password again.
 */
export function ProviderKeys() {
  const t = useT();
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/platform/secrets");
    if (res.ok) setKeys(((await res.json()) as { keys: Key[] }).keys);
    else setMsg({ ok: false, text: (await apiError(res)).message });
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(name: string, remove = false) {
    if (!password) { setMsg({ ok: false, text: "Enter your password first (top of this card)." }); return; }
    setBusy(name); setMsg(null);
    const res = await fetch("/api/platform/secrets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, password, ...(remove ? {} : { value: values[name] ?? "" }) }) });
    setBusy(null);
    if (!res.ok) { const e = await apiError(res); setMsg({ ok: false, text: e.message === "the password is not right" ? "Not saved: your password is not right." : e.message }); return; }
    setValues((v) => ({ ...v, [name]: "" }));
    setMsg({ ok: true, text: remove ? `${name} removed: the server's own value (if any) applies again.` : `${name} saved. The website uses it now; the voice service and worker pick it up within a minute.` });
    void load();
  }

  const groups = keys ? [...new Set(keys.map((k) => k.group))] : [];
  return (
    <Card>
      <CardHeader title="Provider keys" description="Phone carrier, payment gateways, AI, KYC verification and e-mail. Stored encrypted; a saved value is never shown again, only its last four characters. A key saved here overrides the server's env file." />
      <CardBody className="grid gap-4">
        <div className="max-w-sm"><Field label="Your password" hint="Needed for every change here."><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field></div>
        {msg && <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>{t(msg.text)}</p>}
        {!keys && <p className="text-sm text-muted-foreground">{t("Loading…")}</p>}
        {groups.map((g) => (
          <div key={g} className="grid gap-2">
            <h3 className="text-sm font-semibold">{t(g)}</h3>
            {keys!.filter((k) => k.group === g).map((k) => (
              <div key={k.name} className="grid items-center gap-2 rounded-md border border-border p-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]">
                <div className="min-w-0">
                  <div className="font-medium">{t(k.label)}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <code>{k.name}</code>
                    <Badge tone={k.source === "website" ? "success" : k.source === "server" ? "primary" : "warning"}>{t(k.source === "website" ? "Set here" : k.source === "server" ? "From server env" : "Not set")}</Badge>
                    {k.hint && <span>{k.hint}</span>}
                  </div>
                </div>
                <Input aria-label={`New value for ${k.name}`} type={k.secret ? "password" : "text"} placeholder={k.source === "missing" ? t("Enter value") : t("Enter a new value to replace")} value={values[k.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [k.name]: e.target.value }))} autoComplete="off" />
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy === k.name || !(values[k.name] ?? "").trim()} onClick={() => void save(k.name)}>{t("Save")}</Button>
                  {k.source === "website" && <Button size="sm" variant="outline" disabled={busy === k.name} onClick={() => { if (confirm(`Remove the website value of ${k.name}?`)) void save(k.name, true); }}>{t("Remove")}</Button>}
                </div>
              </div>
            ))}
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
