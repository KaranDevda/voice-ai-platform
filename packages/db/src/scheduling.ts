import { sql } from "drizzle-orm";
import { assertAuthorized, type AuthUser } from "@voiceai/auth";
import { withOrg, type Db } from "./client";

export interface HourStat { hourIst: number; attempts: number; answered: number; rate: number }

/** Next occurrence of a valid India calling hour, with enough lead time for the campaign worker to pick it up. */
export function nextBestHourAt(hourIst: number, now = new Date(), leadTimeMs = 5 * 60_000): Date {
  if (!Number.isInteger(hourIst) || hourIst < 9 || hourIst >= 21) throw new RangeError("best calling hour must be between 09:00 and 20:00 India time");
  if (!Number.isFinite(now.getTime()) || !Number.isFinite(leadTimeMs) || leadTimeMs < 0) throw new RangeError("invalid scheduling time");
  const IST_MS = 330 * 60_000;
  const istNow = new Date(now.getTime() + IST_MS);
  const targetIst = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), hourIst);
  let target = targetIst - IST_MS;
  if (target < now.getTime() + leadTimeMs) target += 86_400_000;
  return new Date(target);
}

/**
 * When people actually pick up: for each hour of the day (India time) within the calling window, how many outbound calls were made in the last
 * `days` days and how many were answered. `best` lists the strongest hours that have at least `minAttempts` calls behind them (a rate from 2 calls means nothing).
 */
export async function callTimingStats(db: Db, actor: AuthUser, days = 90, minAttempts = 8) {
  assertAuthorized(actor, "calls.place");
  const d = Math.max(7, Math.min(365, Math.round(days)));
  return withOrg(db, actor.orgId, async (tx) => {
    const r = await tx.execute<{ hour: number; attempts: string; answered: string }>(sql`
      select extract(hour from started_at at time zone 'Asia/Kolkata')::int as hour, count(*)::text as attempts, (count(*) filter (where status = 'connected'))::text as answered
        from call_logs where direction = 'outbound' and started_at >= now() - make_interval(days => ${d}) group by 1 order by 1`);
    const hours: HourStat[] = r.rows.map((x) => ({ hourIst: Number(x.hour), attempts: Number(x.attempts), answered: Number(x.answered), rate: Number(x.attempts) ? Number(x.answered) / Number(x.attempts) : 0 }));
    const totalAttempts = hours.reduce((a, h) => a + h.attempts, 0);
    const best = hours.filter((h) => h.attempts >= minAttempts && h.hourIst >= 9 && h.hourIst < 21).sort((a, b) => b.rate - a.rate || b.attempts - a.attempts).slice(0, 3);
    return { days: d, totalAttempts, hours, best, minAttempts };
  });
}
