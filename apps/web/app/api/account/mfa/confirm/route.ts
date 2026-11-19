import { enableMfa } from "@voiceai/db";
import { z } from "zod";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";
import { encryptionKey } from "@/lib/server";

/** Proves the authenticator works, turns 2FA on, and returns the one-time recovery codes (shown once). */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const b = z.object({ secret: z.string().regex(/^[A-Z2-7]{16,64}$/), code: z.string().regex(/^\d{6}$/) }).safeParse(await req.json().catch(() => null));
  if (!b.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const codes = await enableMfa(getDb(), user, b.data.secret, b.data.code, { encryptionKey: encryptionKey() });
    return codes ? Response.json({ ok: true, codes }) : Response.json({ error: "invalid_code" }, { status: 400 });
  } catch (err) { return toResponse(err); }
}
