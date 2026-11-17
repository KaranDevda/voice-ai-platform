import { listJobs } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { getDb, requireUser } from "@/lib/server";

/** Platform staff can refresh background-worker health without reloading the full administration page. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const jobs = await listJobs(getDb(), user);
    return Response.json(jobs, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return toResponse(error);
  }
}
