import { profitReport } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { getDb, requireUser } from "@/lib/server";

const rupees = (p: number) => (p / 100).toFixed(2);
const cell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;

/** Platform staff: the profit report as a CSV file (by day, then by organisation and by country). ?days=7|30|90 */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const days = Number(new URL(req.url).searchParams.get("days")) || 30;
    const r = await profitReport(getDb(), user, days);
    const head = ["revenue_rs", "call_minutes", "texts", "est_carrier_cost_rs", "est_profit_rs"];
    const row = (b: { revenuePaise: number; callMinutes: number; texts: number; costPaise: number; profitPaise: number }) => [rupees(b.revenuePaise), b.callMinutes, b.texts, rupees(b.costPaise), rupees(b.profitPaise)];
    const lines = [
      [cell("section"), cell("name"), ...head.map(cell)].join(","),
      ...r.byDay.map((d) => [cell("day"), cell(d.day), ...row(d).map(cell)].join(",")),
      ...r.byOrg.map((o) => [cell("organisation"), cell(o.orgName), ...row(o).map(cell)].join(",")),
      ...r.byCountry.map((c) => [cell("country"), cell(c.country), ...row(c).map(cell)].join(",")),
    ];
    return new Response(lines.join("\n") + "\n", { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="profit-${r.days}-days.csv"`, "cache-control": "private, no-store" } });
  } catch (err) { return toResponse(err); }
}
