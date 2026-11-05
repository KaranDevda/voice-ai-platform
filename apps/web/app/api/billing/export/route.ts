import { listLedger, listPayments } from "@voiceai/db";
import { toResponse } from "@/lib/api-errors";
import { getDb, requireUser } from "@/lib/server";

const cell = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const rupees = (p: number) => (p / 100).toFixed(2);
/** Spreadsheet formulas typed into a note ("=…", "+…", "-…", "@…") must not run when the file is opened: they get a leading apostrophe. */
const safe = (v: string | null | undefined) => (v && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v ?? "");

/** ?kind=ledger (default) or payments; for the ledger also ?reason=, ?from=YYYY-MM-DD, ?to=YYYY-MM-DD. Up to 20,000 rows, as a CSV file. */
export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  try {
    const q = new URL(req.url).searchParams;
    const date = (k: string) => { const v = q.get(k); return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00+05:30`) : undefined; };
    let lines: string[], name: string;
    if (q.get("kind") === "payments") {
      const rows = await listPayments(getDb(), user, 20_000);
      lines = [["when_utc", "gateway", "gateway_payment_id", "currency", "paid_amount", "credited_rs", "status"].map(cell).join(","), ...rows.map((p) => [p.createdAt.toISOString(), p.gateway, p.gatewayPaymentId, p.currency, p.currency === "INR" ? rupees(p.amountPaise) : ((p.amountMinor ?? 0) / 100).toFixed(2), rupees(p.amountPaise), p.status].map(cell).join(","))];
      name = "payments";
    } else {
      const to = date("to");
      const { rows } = await listLedger(getDb(), user, { reason: q.get("reason") || undefined, from: date("from"), to: to ? new Date(to.getTime() + 86_400_000) : undefined, limit: 20_000 });
      lines = [["when_utc", "kind", "change_rs", "country", "reference", "note"].map(cell).join(","), ...rows.map((l) => [l.createdAt.toISOString(), l.reason, rupees(l.deltaPaise), l.country, l.ref, safe(l.note)].map(cell).join(","))];
      name = "credit-history";
    }
    return new Response("﻿" + lines.join("\n") + "\n", { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "private, no-store" } });
  } catch (err) { return toResponse(err); }
}
