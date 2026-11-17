import { streamSmsCsv } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { getDb, requireUser } from "@/lib/server";

export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    return new Response(streamSmsCsv(getDb(), user), { headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="sms-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    } });
  } catch (err) { return toResponse(err); }
}
