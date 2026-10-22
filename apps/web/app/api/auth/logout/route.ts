import { cookies } from "next/headers";
import { assertSameOrigin } from "@/lib/server";
import { json } from "@/lib/auth-routes";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST() {
  if (!(await assertSameOrigin())) return json({ error: "bad_origin" }, 403);
  (await cookies()).delete(SESSION_COOKIE);
  return json({ ok: true });
}
