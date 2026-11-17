import { streamContactsCsv } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { getDb, requireUser } from "@/lib/server";

/** Stream the actor's permitted contacts as CSV; the database records a lead-export audit event. */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const params = new URL(req.url).searchParams;
    const filters = {
      q: params.get("q") ?? undefined,
      status: params.get("status") ?? undefined,
      heat: params.get("heat") ?? undefined,
      sort: params.get("sort") ?? undefined,
      tag: params.get("tag") ?? undefined,
      consent: params.get("consent") ?? undefined,
      dnd: params.get("dnd") ?? undefined,
      field: params.get("field") ?? undefined,
      history: params.get("history") ?? undefined,
    };
    return new Response(streamContactsCsv(getDb(), user, filters), { headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="contacts-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    } });
  } catch (err) { return toResponse(err); }
}
