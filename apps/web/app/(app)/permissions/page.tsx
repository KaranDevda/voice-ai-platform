import { listRoles, updateRole } from "@voiceai/db";
import { Forbidden } from "@/components/forbidden";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Select } from "@/components/ui/form";
import { allowed, requirePageUser } from "@/lib/page-auth";
import { getDb } from "@/lib/server";
import { FLAG_PERMISSIONS, type Permission, SCOPED_PERMISSIONS } from "@voiceai/auth";
import { useState } from "react";

const SCOPED_BASES = Object.keys(SCOPED_PERMISSIONS) as Array<keyof typeof SCOPED_PERMISSIONS>;
const SCOPES = ["all", "team", "own", "aggregate"] as const;
const ROLE_KEYS = ["super_admin", "org_admin", "manager", "agent", "qa_auditor", "viewer"] as const;

export default async function PermissionsPage() {
  const user = await requirePageUser();
  if (!user.permissions.includes("platform.admin")) return <Forbidden />;
  const roles = (await allowed(() => listRoles(getDb(), user))) as Array<{ id: string; key: string; name: string; permissions: Permission[] }> | null;
  if (!roles) return <Forbidden />;
  return (
    <>
      <PageHeader title="Permission matrix" description="Edit which scoped permissions each role receives. Flag permissions are on/off per role. Changes take effect on next login." actions={<SaveAllButton roles={roles} />} />
      <Card>
        <CardHeader title="Scoped permissions (leads, calls, recordings, etc.)" description="Each cell = scope level. 'all' > 'team' > 'own' > 'aggregate'." />
        <CardBody>
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th>Role</Th>
                  {SCOPED_BASES.map((base) => <Th key={base} className="text-center min-w-[100px]">{base.replace(/_/g, " ")}</Th>)}
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <PermissionRow key={r.key} role={r} roles={roles} />
                ))}
              </tbody>
            </Table>
          </div>
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Flag permissions (on/off)" description="These are not scoped — a role either has them or not." />
        <CardBody>
          <div className="overflow-x-auto">
            <Table>
              <thead><tr><Th>Role</Th>{FLAG_PERMISSIONS.map((f) => <Th key={f} className="text-center min-w-[140px]">{f}</Th>)}</tr></thead>
              <tbody>
                {roles.map((r) => (
                  <FlagRow key={r.key} role={r} roles={roles} />
                ))}
              </tbody>
            </Table>
          </div>
        </CardBody>
      </Card>
    </>
  );
}

function PermissionRow({ role, roles }: { role: { key: string; name: string; permissions: Permission[] }; roles: Array<{ key: string; permissions: Permission[] }> }) {
  "use client";

  const [busy, setBusy] = useState<Set<string>>(new Set());

  // Parse scoped permissions into base -> scope map
  const [local, setLocal] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const base of SCOPED_BASES) {
      const perm = role.permissions.find((p) => p.startsWith(base + "."));
      map[base] = perm ? perm.split(".").pop() ?? "aggregate" : "aggregate";
    }
    return map;
  });

  async function save(base: string) {
    const scope = local[base];
    const key = base + "." + scope;
    setBusy((b) => new Set([...b, base]));
    try {
      const res = await fetch(`/api/roles/${role.key}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ permission: key, add: true }),
      });
      if (!res.ok) { alert("Failed to save"); return; }
      setLocal((l: Record<string, string>) => Object.assign({}, l, { [base]: scope }));
    } finally { setBusy((b) => new Set([...b].filter((x) => x !== base))); }
  }

  return (
    <Tr>
      <Td className="font-medium">{role.name}</Td>
      {SCOPED_BASES.map((base) => {
        const currentScope = local[base];
        const hasPerm = role.permissions.some((p) => p.startsWith(base + ".") && p.split(".").pop() === currentScope);
        return (
          <Td key={base} className="text-center">
            <Select
              value={local[base]}
              onChange={(e) => setLocal((l: Record<string, string>) => Object.assign({}, l, { [base]: e.target.value }))}
              disabled={busy.has(base)}
              aria-label={`${base} scope`}
            >
              {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </Select>
            <Button size="sm" variant="outline" className="mt-1" onClick={() => save(base)} disabled={busy.has(base) || hasPerm}>
              {busy.has(base) ? "…" : "Save"}
            </Button>
          </Td>
        );
      })}
    </Tr>
  );
}

function FlagRow({ role, roles }: { role: { key: string; name: string; permissions: Permission[] }; roles: Array<{ key: string; permissions: Permission[] }> }) {
  "use client";

  const [busy, setBusy] = useState<Set<string>>(new Set());
  const has = (flag: string) => role.permissions.some((p) => p === flag);

  async function toggle(flag: string) {
    setBusy((b) => new Set([...b, flag]));
    try {
      const res = await fetch(`/api/roles/${role.key}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ permission: flag, add: !has(flag) }),
      });
      if (!res.ok) { alert("Failed to save"); return; }
    } finally { setBusy((b) => new Set([...b].filter((x) => x !== flag))); }
  }

  return (
    <Tr>
      <Td className="font-medium">{role.name}</Td>
      {FLAG_PERMISSIONS.map((flag) => (
        <Td key={flag} className="text-center">
          <Button
            size="sm"
            variant={has(flag) ? "default" : "outline"}
            onClick={() => toggle(flag)}
            disabled={busy.has(flag)}
            aria-pressed={has(flag)}
          >
            {busy.has(flag) ? "…" : has(flag) ? "On" : "Off"}
          </Button>
        </Td>
      ))}
    </Tr>
  );
}

function SaveAllButton({ roles }: { roles: Array<{ key: string; name: string; permissions: Permission[] }> }) {
  "use client";

  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  return (
    <Button variant="outline" disabled={busy} onClick={async () => {
      setBusy(true); setNote("");
      try {
        // Could implement a bulk save endpoint here
        setNote("Use per-row Save buttons for now.");
      } finally { setBusy(false); }
    }}>
      {busy ? "Saving…" : "Save all"}
    </Button>
  );
}