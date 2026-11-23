"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { apiError } from "@/lib/api-client";
import { Button } from "./ui/button";
import { Card, CardBody, CardHeader } from "./ui/card";
import { Field, Input, Select } from "./ui/form";
import { T } from "./t";

/** Must match ASSIGNABLE_ROLES in @voiceai/db (the server checks it again). */
const ROLES = [
  ["org_admin", "Org admin: everything in this organisation"],
  ["manager", "Manager: their team"],
  ["agent", "Agent: their own leads and calls"],
  ["qa_auditor", "QA auditor: read-only calls"],
  ["viewer", "Viewer: summary numbers only"],
] as const;

async function post(url: string, body: unknown): Promise<string | null> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.ok ? null : (await apiError(res)).message;
}

/** "Add a person": e-mail, one role, optional team, and a first password the admin passes on privately. */
export function AddTeamMember({ teams }: { teams: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true); setMsg(null);
    const email = String(f.get("email") ?? "").trim();
    const error = await post("/api/team", { email, role: f.get("role"), teamId: f.get("teamId") || null, password: String(f.get("password") ?? "") });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: error }); return; }
    form.reset();
    setMsg({ ok: true, text: `Added ${email}. Give them the first password privately; admins, managers and QA set up 2FA when they first sign in.` });
    router.refresh();
  }

  return (
    <Card>
      <CardHeader title="Add a person" description="They sign in with this e-mail and the first password you set. Every addition is written to the audit log." />
      <CardBody>
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="E-mail"><Input name="email" type="email" required maxLength={320} placeholder="name@company.com" autoComplete="off" /></Field>
          <Field label="Role">
            <Select name="role" defaultValue="agent">{ROLES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</Select>
          </Field>
          <Field label="Team" hint="Managers and agents see their team's work.">
            <Select name="teamId" defaultValue=""><option value="">No team</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
          </Field>
          <Field label="First password" hint="At least 12 characters, not containing their e-mail.">
            <Input name="password" type="password" required minLength={12} maxLength={200} autoComplete="new-password" />
          </Field>
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" disabled={busy}>{busy ? "Adding…" : "Add person"}</Button>
            {msg && <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}><T>{msg.text}</T></span>}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

/** Per-person controls in the People table: change role, switch off / back on. */
export function MemberControls({ id, email, roles, status }: { id: string; email: string; roles: string[]; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Platform staff accounts are managed by platform staff, not from here.
  if (roles.includes("super_admin")) return null;
  const current = roles.find((r) => ROLES.some(([k]) => k === r)) ?? "";

  async function run(url: string, body: unknown, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true); setError("");
    const e = await post(url, body);
    setBusy(false);
    if (e) setError(e); else router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Select aria-label={`Role for ${email}`} value={current} disabled={busy} className="w-auto"
        onChange={(e) => void run(`/api/team/${id}/role`, { role: e.target.value }, `Change ${email}'s role to ${e.target.value.replace(/_/g, " ")}?`)}>
        {!current && <option value="">Choose a role</option>}
        {ROLES.map(([k]) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
      </Select>
      {status === "active"
        ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(`/api/team/${id}/status`, { status: "disabled" }, `Switch off ${email}? They are signed out and cannot sign in until switched back on.`)}><T>Switch off</T></Button>
        : <Button size="sm" variant="outline" disabled={busy} onClick={() => void run(`/api/team/${id}/status`, { status: "active" })}><T>Switch on</T></Button>}
      {error && <span role="alert" className="w-full text-end text-xs text-danger"><T>{error}</T></span>}
    </div>
  );
}
