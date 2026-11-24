import { z } from "zod";
import { confirmOwnPassword, deletePlatformSecret, listPlatformSecrets, setPlatformSecret } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

/** Platform staff: which provider keys are set and where from (website, server env file, missing). Values are never returned. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!user.permissions.includes("platform.admin")) return Response.json({ error: "forbidden" }, { status: 403 });
  try { return Response.json({ keys: await listPlatformSecrets(getDb(), user) }); } catch (err) { return toResponse(err); }
}

const body = z.object({ name: z.string().regex(/^[A-Z][A-Z0-9_]{2,63}$/), value: z.string().max(4000).optional(), password: z.string().min(1).max(500) });

/** Sets a provider key (value given) or removes the website value (no value). Needs the staff member's password again. Audited. */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!user.permissions.includes("platform.admin")) return Response.json({ error: "forbidden" }, { status: 403 });
  const b = body.safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    await confirmOwnPassword(getDb(), user, b.data.password);
    if (b.data.value && b.data.value.trim()) return Response.json(await setPlatformSecret(getDb(), user, b.data.name, b.data.value));
    await deletePlatformSecret(getDb(), user, b.data.name);
    return Response.json({ name: b.data.name, removed: true });
  } catch (err) { return toResponse(err); }
}
