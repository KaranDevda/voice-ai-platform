import { z } from "zod";
import { getCampaign, updateCampaignStatus } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const id = z.string().uuid();

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const p = id.safeParse((await params).id);
  if (!p.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try {
    const c = await getCampaign(getDb(), user, p.data);
    return c ? Response.json(c) : Response.json({ error: "not_found" }, { status: 404 });
  } catch (err) { return toResponse(err); }
}

/** { action: "start" | "pause" | "resume" | "cancel" } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  const p = id.safeParse((await params).id);
  const b = z.object({ action: z.enum(["start", "pause", "resume", "cancel"]) }).safeParse(await req.json().catch(() => null));
  if (!p.success || !b.success) return Response.json({ error: "invalid_request" }, { status: 400 });
  try { return Response.json(await updateCampaignStatus(getDb(), user, p.data, b.data.action)); } catch (err) { return toResponse(err); }
}
