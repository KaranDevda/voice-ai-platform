/** Selling price from a carrier cost and a profit margin. All prices are whole paise (100 paise = Rs 1). */
export const MAX_MARGIN_PCT = 1000;

/** Cost plus a percentage on top (markup), rounded UP to a whole paise so rounding never eats the margin. A zero cost stays zero. */
export function priceWithMargin(costPaise: number, marginPct: number): number {
  if (!Number.isFinite(costPaise) || costPaise < 0) throw new RangeError("the cost must be zero or more");
  if (!Number.isFinite(marginPct) || marginPct < 0 || marginPct > MAX_MARGIN_PCT) throw new RangeError(`the margin must be from 0 to ${MAX_MARGIN_PCT} percent`);
  return Math.ceil(Math.round(costPaise * (100 + marginPct)) / 100);
}

/** Profit as a share of the selling price (0 when nothing was charged). */
export function marginOfRevenuePct(revenuePaise: number, costPaise: number): number {
  return revenuePaise > 0 ? Math.round(((revenuePaise - costPaise) / revenuePaise) * 1000) / 10 : 0;
}
