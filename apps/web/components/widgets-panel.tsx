"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Select, Textarea } from "./ui/form";

interface Widget { id: string; name: string; key: string; origins: string[]; language: string; active: boolean }

/** Website voice widgets: the sites allowed to show the button, and the line of code to paste into those pages. */
export function WidgetsPanel({ canEdit, widgets }: { canEdit: boolean; widgets: Widget[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [sites, setSites] = useState("https://");
  const [language, setLanguage] = useState("en-hi");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const snippet = (key: string) => `<script src="${typeof window === "undefined" ? "" : window.location.origin}/widget.js" data-key="${key}" async></script>`;

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    const res = await fetch("/api/widgets", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, language, origins: sites.split(/[\s,]+/).filter(Boolean) }) });
    const b = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(b.message ?? b.issues?.[0]?.message ?? b.error ?? "Could not create it");
    setName(""); setSites("https://");
    router.refresh();
  }
  async function act(id: string, action: string) {
    if (action === "delete" && !confirm("Remove this widget? The button on your website stops working.")) return;
    setError("");
    const res = await fetch(`/api/widgets/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    if (!res.ok) setError(((await res.json().catch(() => ({}))) as { message?: string }).message ?? "That did not work");
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      {canEdit && (
        <Card>
          <CardHeader title="New website widget" description="A button on your own website that lets visitors talk to your AI agent by voice. Only the sites you list can use it." />
          <CardBody>
            <form onSubmit={create} className="grid gap-3 md:grid-cols-2">
              <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></Field>
              <Field label="Language"><Select value={language} onChange={(e) => setLanguage(e.target.value)}><option value="en-hi">Hindi + English</option><option value="hi">Hindi</option><option value="en">English</option></Select></Field>
              <div className="md:col-span-2"><Field label="Sites allowed to show it" hint="One per line, like https://www.example.com (https only, no page path). Use https://localhost:3000 style only for testing."><Textarea rows={3} value={sites} onChange={(e) => setSites(e.target.value)} required /></Field></div>
              <div><Button type="submit" disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create widget"}</Button></div>
            </form>
            {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="Your widgets" description="Calls through a widget use your agent's settings and are saved in the call logs. Visitors need no account." />
        {widgets.length === 0 ? <CardBody><p className="text-sm text-muted-foreground">No widgets yet.</p></CardBody> : (
          <CardBody className="grid gap-5">
            {widgets.map((w) => (
              <div key={w.id} className="grid gap-2 border-b border-border pb-5 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{w.name}</span><Badge tone={w.active ? "success" : "neutral"}>{w.active ? "On" : "Off"}</Badge><span className="text-xs text-muted-foreground">{w.origins.join(", ")}</span></div>
                <code className="break-all rounded-md bg-muted px-3 py-2 text-xs">{snippet(w.key)}</code>
                {canEdit && <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void act(w.id, w.active ? "disable" : "enable")}>{w.active ? "Turn off" : "Turn on"}</Button><Button size="sm" variant="outline" onClick={() => void act(w.id, "delete")}>Remove</Button></div>}
              </div>
            ))}
          </CardBody>
        )}
      </Card>
    </div>
  );
}
