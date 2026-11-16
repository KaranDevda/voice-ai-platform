import { streamContactsCsv } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { getDb, requireUser } from "@/lib/server";

/** Stream the actor's permitted contacts as CSV; the database records a lead-export audit event. */
export async function GET() {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    return new Response(streamContactsCsv(getDb(), user), { headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    } });
  } catch (err) { return toResponse(err); }
}
