import {
  AUDITED_PERMISSIONS,
  FLAG_PERMISSIONS,
  SCOPE_ORDER,
  SCOPED_PERMISSIONS,
  type FlagPermission,
  type Scope,
  type ScopedBase,
} from "./permissions";

export interface AuthUser {
  id: string;
  orgId: string;
  /** Teams the user belongs to or manages ("own team(s)" for managers, "assigned teams" for QA). */
  teamIds: readonly string[];
  /** Union of roles.permissions over the user's roles. */
  permissions: readonly string[];
}

/** The record being accessed. Omit for list/aggregate checks and use resolveScope to build the query filter. */
export interface Resource {
  orgId: string;
  teamId?: string | null;
  /** leads.owner_user_id, call_logs.agent_user_id, ... */
  ownerUserId?: string | null;
}

export interface AuthorizeOptions {
  /** Required for a platform admin to touch recordings (SOP: break-glass). */
  breakGlassReason?: string;
}

export interface Decision {
  allowed: boolean;
  scope?: Scope;
  reason?: string;
  /** Caller must write an audit_logs row (also for break-glass). */
  audit: boolean;
}

const isScoped = (p: string): p is ScopedBase => p in SCOPED_PERMISSIONS;
const isFlag = (p: string): p is FlagPermission => (FLAG_PERMISSIONS as readonly string[]).includes(p);

/** Widest scope the user holds for a base permission such as "leads.read", or null. */
export function resolveScope(user: AuthUser, base: ScopedBase): Scope | null {
  const held = new Set(user.permissions);
  return SCOPE_ORDER.find((s) => held.has(`${base}.${s}`)) ?? null;
}

export function authorize(
  user: AuthUser,
  permission: ScopedBase | FlagPermission,
  resource?: Resource,
  options: AuthorizeOptions = {},
): Decision {
  const isPlatform = user.permissions.includes("platform.admin");
  const audit = AUDITED_PERMISSIONS.has(permission);
  const deny = (reason: string): Decision => ({ allowed: false, reason, audit: false });

  if (resource && resource.orgId !== user.orgId && !isPlatform) return deny("cross_org");

  if (isFlag(permission)) {
    return user.permissions.includes(permission) ? { allowed: true, audit } : deny("missing_permission");
  }
  if (!isScoped(permission)) return deny("unknown_permission");

  const scope = resolveScope(user, permission);
  if (!scope) return deny("missing_permission");

  // Recordings across orgs need a logged break-glass reason, even for platform admins.
  const crossOrg = resource !== undefined && resource.orgId !== user.orgId;
  if (permission.startsWith("recordings.") && isPlatform && crossOrg && !options.breakGlassReason?.trim()) {
    return deny("break_glass_required");
  }
  const breakGlass = permission.startsWith("recordings.") && isPlatform && crossOrg;

  if (!resource) return { allowed: true, scope, audit };
  if (scope === "aggregate") return deny("aggregate_only");

  const ok =
    scope === "all" ||
    (scope === "team" && !!resource.teamId && user.teamIds.includes(resource.teamId)) ||
    (scope === "own" && resource.ownerUserId === user.id);

  return ok ? { allowed: true, scope, audit: audit || breakGlass } : deny("out_of_scope");
}

export class ForbiddenError extends Error {
  constructor(public readonly permission: string, public readonly reason?: string) {
    super(`Forbidden: ${permission}${reason ? ` (${reason})` : ""}`);
  }
}

/** Throwing variant for route handlers, server actions and the voice service. */
export function assertAuthorized(
  user: AuthUser,
  permission: ScopedBase | FlagPermission,
  resource?: Resource,
  options?: AuthorizeOptions,
): Decision {
  const d = authorize(user, permission, resource, options);
  if (!d.allowed) throw new ForbiddenError(permission, d.reason);
  return d;
}
