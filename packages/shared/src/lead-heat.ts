/** How warm a lead is, from its score (0 to 100, worked out in the database: see migration 0024). */
export const HOT_MIN = 70, WARM_MIN = 40;
export type Heat = "hot" | "warm" | "cold";
export const HEATS: readonly Heat[] = ["hot", "warm", "cold"];
export const heatOf = (score: number | null | undefined): Heat | null => (score == null ? null : score >= HOT_MIN ? "hot" : score >= WARM_MIN ? "warm" : "cold");
/** The score range for a heat, for filtering: hot 70 to 100, warm 40 to 69, cold 0 to 39. */
export const heatRange = (h: Heat): [number, number] => (h === "hot" ? [HOT_MIN, 100] : h === "warm" ? [WARM_MIN, HOT_MIN - 1] : [0, WARM_MIN - 1]);
