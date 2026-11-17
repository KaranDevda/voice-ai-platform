import { z } from "zod";
import { createAgentProfile, listAgentProfiles } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({
  name: z.string().trim().min(1).max(80),
  instructions: z.string().trim().min(1).max(6000),
  knowledgeText: z.string().trim().min(1).max(12000),
});

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const profiles = await listAgentProfiles(getDb(), user);
    return Response.json(profiles.map(({ id, name }) => ({ id, name })));
  } catch (err) { return toResponse(err); }
}

export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  try { return Response.json(await createAgentProfile(getDb(), user, parsed.data), { status: 201 }); } catch (err) { return toResponse(err); }
}
