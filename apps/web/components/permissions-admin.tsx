"use client";
import { Button } from "@/components/ui/button";
import { Table, Td, Th, Tr } from "@/components/ui/table";
import { Select } from "@/components/ui/form";
import type { Permission } from "@voiceai/auth";
import { useState } from "react";

const SCOPES = ["all", "team", "own", "aggregate"] as const;

export function PermissionRow({ role, roles, bases }: { bases: readonly string[]; role: { key: string; name: string; permissions: Permission[] }; roles: Array<{ key: string; permissions: Permission[] }> }) {

  const [busy, setBusy] = useState<Set<string>>(new Set());

  // Parse scoped permissions into base -> scope map
  const [local, setLocal] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const base of bases) {
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
      {bases.map((base) => {
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

export function FlagRow({ role, roles, flags }: { flags: readonly string[]; role: { key: string; name: string; permissions: Permission[] }; roles: Array<{ key: string; permissions: Permission[] }> }) {

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
      {flags.map((flag) => (
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

export function SaveAllButton({ roles }: { roles: Array<{ key: string; name: string; permissions: Permission[] }> }) {

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