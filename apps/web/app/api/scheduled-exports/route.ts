import { z } from "zod";
import { createCronJob, listCronJobs } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { assertSameOrigin, getDb, requireUser } from "@/lib/server";

const body = z.object({
  name: z.string().trim().min(1).max(80),
  reportType: z.enum(["contacts", "calls", "sms"]),
  cron: z.string().regex(/^(@\w+|(\*|([0-9\-\/]+))\s+){4}(\*|([0-9\-\/]+))$/),
  timezone: z.string().default("Asia/Kolkata"),
  email: z.string().email().optional().nullable(),
});

export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!user.permissions.some((p) => p.startsWith("leads.export."))) return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    const jobs = await listCronJobs(getDb(), user);
    return Response.json(jobs);
  } catch (err) { return toResponse(err); }
}

export async function POST(req: Request) {
  if (!(await assertSameOrigin())) return Response.json({ error: "bad_origin" }, { status: 403 });
  const user = await requireUser();
  if (user instanceof Response) return user;
  if (!user.permissions.some((p) => p.startsWith("leads.export."))) return Response.json({ error: "forbidden" }, { status: 403 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 });
  try {
    const job = await createCronJob(getDb(), user, parsed.data);
    return Response.json(job, { status: 201 });
  } catch (err) { return toResponse(err); }
}