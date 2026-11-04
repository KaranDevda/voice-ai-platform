import { z } from "zod";
import { platformFindUsers } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { getDb, requireUser } from "@/lib/server";

/** Platform staff: find a person by e-mail, in any organisation. */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const email = z.string().min(3).max(200).safeParse(new URL(req.url).searchParams.get("email"));
  if (!email.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try { return Response.json(await platformFindUsers(getDb(), user, email.data)); } catch (err) { return toResponse(err); }
}
