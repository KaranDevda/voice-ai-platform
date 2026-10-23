import "server-only";
import { redirect } from "next/navigation";
import { ForbiddenError, resolveScope, type AuthUser, type FlagPermission, type ScopedBase } from "@voiceai/auth";
import { getDb, getAuthUser } from "./server";
import { getUserProfile } from "@voiceai/db";

/** Page-level auth: signed-in user or redirect to /login. */
export async function requirePageUser(): Promise<AuthUser> {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  return user;
}

/** Runs a scoped query; a ForbiddenError becomes null so the page can render its own "no access" state. */
export async function allowed<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ForbiddenError) return null;
    throw err;
  }
}

const can = (u: AuthUser, p: FlagPermission) => u.permissions.includes(p);
const recordScope = (u: AuthUser, base: ScopedBase) => {
  const s = resolveScope(u, base);
  return !!s && s !== "aggregate";
};

export interface NavItem { href: string; label: string; icon: string; visible: boolean }
export interface NavGroup { label: string; items: Array<Omit<NavItem, "visible">> }

/** Sidebar groups, filtered to what this user may open. Empty groups are dropped. */
export function navFor(u: AuthUser): NavGroup[] {
  const studio = can(u, "studio.use");
  const groups: Array<{ label: string; items: NavItem[] }> = [
    {
      label: "Studio",
      items: [
        { href: "/", label: "Launchpad", icon: "launchpad", visible: true },
        { href: "/studio", label: "Studio", icon: "studio", visible: studio },
        { href: "/clone", label: "Voice clone", icon: "clone", visible: studio && can(u, "voice_profiles.manage") },
        { href: "/transcribe", label: "Transcribe", icon: "transcribe", visible: studio },
        { href: "/agent-console", label: "Agent console", icon: "agent", visible: studio },
        { href: "/library", label: "Voice library", icon: "library", visible: studio },
        { href: "/projects", label: "Projects", icon: "projects", visible: !!resolveScope(u, "projects.read") },
      ],
    },
    {
      label: "Operations",
      items: [
        { href: "/dashboard", label: "Dashboard", icon: "dashboard", visible: true },
        { href: "/leads", label: "Leads", icon: "leads", visible: recordScope(u, "leads.read") },
        { href: "/calls", label: "Call logs", icon: "calls", visible: recordScope(u, "calls.read") },
        { href: "/dialer", label: "Web dialer", icon: "dialer", visible: can(u, "calls.place") },
        { href: "/reports", label: "Agent reports", icon: "reports", visible: !!resolveScope(u, "reports.read") },
      ],
    },
    {
      label: "Admin",
      items: [
        { href: "/voices", label: "Voices & consent", icon: "voices", visible: can(u, "voice_profiles.manage") },
        { href: "/knowledge", label: "Knowledge base", icon: "knowledge", visible: can(u, "kb.read") },
        { href: "/team", label: "Team & devices", icon: "team", visible: !!resolveScope(u, "users.read") },
        { href: "/audit", label: "Audit log", icon: "audit", visible: can(u, "audit.read") },
        { href: "/logs", label: "Provider logs", icon: "logs", visible: can(u, "logs.read") },
        { href: "/settings", label: "Settings", icon: "settings", visible: can(u, "org_settings.read") || can(u, "ai_prompts.read") },
      ],
    },
  ];
  return groups
    .map((g) => ({ label: g.label, items: g.items.filter((i) => i.visible).map(({ visible: _v, ...i }) => i) }))
    .filter((g) => g.items.length);
}

export const profileOf = (user: AuthUser) => getUserProfile(getDb(), user);
