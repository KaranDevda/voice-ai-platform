import { z } from "zod";
import { setLandingText } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({
  headline: z.string().max(60),
  text: z.string().max(140),
});

/** Back to the editor after a plain form post, so the browser never lands on raw JSON. */
const backToEditor = (query: string) => new Response(null, { status: 303, headers: { location: `/theme-builder?${query}` } });

/**
 * Platform staff: sign-in page headline and sub-text. Accepts the theme-builder's plain HTML form (redirects back to it)
 * or JSON (answers in JSON). The body is read exactly once: a request body cannot be read twice.
 */
export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!user.permissions.includes("platform.admin")) return Response.json({ error: "forbidden" }, { status: 403 });
  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
  const raw = isJson ? await req.json().catch(() => null) : Object.fromEntries((await req.formData().catch(() => new FormData())).entries());
  const parsed = body.safeParse(raw);
  if (!parsed.success) return isJson ? Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 }) : backToEditor("error=invalid");
  try {
    const result = await setLandingText(getDb(), user, { headline: parsed.data.headline.trim(), text: parsed.data.text.trim() });
    return isJson ? Response.json(result) : backToEditor("saved=1");
  } catch (err) {
    return isJson ? toResponse(err) : backToEditor("error=failed");
  }
}
