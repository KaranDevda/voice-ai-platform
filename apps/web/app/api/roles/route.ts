import { z } from "zod";
import { listRoles, updateRole } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!user.permissions.includes("platform.admin")) return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    const roles = await listRoles(getDb(), user);
    return Response.json(roles);
  } catch (err) { return toResponse(err); }
}