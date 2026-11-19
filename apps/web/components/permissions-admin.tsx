"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Td, Tr } from "@/components/ui/table";
import { Select } from "@/components/ui/form";

type Role = { key: string; name: string; permissions: string[] };

async function patch(roleKey: string, body: object): Promise<string | null> {
  const res = await fetch(`/api/roles/${roleKey}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (res.ok) return null;
  if (res.status === 401 || res.status === 403) return "You are no longer signed in as a platform admin. Another tab may have signed in as a different user. Sign in as admin@demo.io again.";
  const b = await res.json().catch(() => ({}));
  return b.message ? `${b.message[0].toUpperCase()}${b.message.slice(1)}.` : "Could not save.";
}

/** One role's reach for each scoped permission. Choosing a value saves it straight away, and replaces the previous one. */
export function PermissionRow({ role, bases, allowed }: { role: Role; bases: readonly string[]; allowed: Record<string, readonly string[]> }) {
  const router = useRouter();
  const widest = (base: string) => (allowed[base] ?? []).find((s) => role.permissions.includes(`${base}.${s}`)) ?? "none";
  const [local, setLocal] = useState<Record<string, string>>(() => Object.fromEntries(bases.map((b) => [b, widest(b)])));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function change(base: string, value: string) {
    const before = local[base];
    setLocal((l) => ({ ...l, [base]: value })); setBusy(base); setError("");
    const err = await patch(role.key, { base, scope: value === "none" ? null : value });
    setBusy(null);
    if (err) { setLocal((l) => ({ ...l, [base]: before! })); setError(err); } else router.refresh();
  }

  return (
    <Tr>
      <Td className="font-medium">{role.name}{error && <span role="alert" className="block text-xs font-normal text-danger">{error}</span>}</Td>
      {bases.map((base) => (
        <Td key={base} className="text-center">
          <Select value={local[base]} onChange={(e) => void change(base, e.target.value)} disabled={busy === base} aria-label={`${role.name}: ${base}`}>
            <option value="none">none</option>
            {(allowed[base] ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
          </Select>
        </Td>
      ))}
    </Tr>
  );
}

/** One role's on/off permissions. */
export function FlagRow({ role, flags }: { role: Role; flags: readonly string[] }) {
  const router = useRouter();
  const [on, setOn] = useState<Set<string>>(() => new Set(role.permissions));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function toggle(flag: string) {
    const add = !on.has(flag);
    setBusy(flag); setError("");
    const err = await patch(role.key, { permission: flag, add });
    setBusy(null);
    if (err) return setError(err);
    setOn((s) => { const n = new Set(s); if (add) n.add(flag); else n.delete(flag); return n; });
    router.refresh();
  }

  return (
    <Tr>
      <Td className="font-medium">{role.name}{error && <span role="alert" className="block text-xs font-normal text-danger">{error}</span>}</Td>
      {flags.map((flag) => (
        <Td key={flag} className="text-center">
          <Button size="sm" variant={on.has(flag) ? "default" : "outline"} onClick={() => void toggle(flag)} disabled={busy === flag} aria-pressed={on.has(flag)}>
            {busy === flag ? "…" : on.has(flag) ? "On" : "Off"}
          </Button>
        </Td>
      ))}
    </Tr>
  );
}
