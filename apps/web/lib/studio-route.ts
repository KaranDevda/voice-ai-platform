import "server-only";
import { authorize, type AuthUser } from "@voiceai/auth";
import { assertSameOrigin, requireUser } from "./server";
import { toResponse } from "./api-errors";

/** Common wrapper: same-origin check (for mutations), signed-in user, `studio.use`, then domain-error mapping. */
export async function studioRoute(
  opts: { mutation?: boolean },
  handler: (user: AuthUser) => Promise<Response>,
): Promise<Response> {
  if (opts.mutation && !(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!authorize(user, "studio.use").allowed) return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    return await handler(user);
  } catch (err) {
    return toResponse(err);
  }
}
