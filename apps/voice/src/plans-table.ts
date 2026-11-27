/**
 * Turns the plan sentences in the company knowledge ("The Starter plan costs 1,999 rupees per month and includes ...") into table rows
 * for the Live page, so a plans question is shown as a neat table while the AI explains it in plain speech. Nothing is invented: a plan
 * only appears if the knowledge states it.
 */
export interface PlanRow { name: string; price: string; includes: string }
export interface PlansCard { rows: PlanRow[]; notes: string[] }

const ASKS_ABOUT_PLANS = /\b(plans?|pricing|prices?|cost|packages?|rates?|subscription|how much|compare|comparison)\b|प्लान|प्राइस|कीमत|कितना|पैकेज|दाम/i;
export const asksAboutPlans = (text: string) => ASKS_ABOUT_PLANS.test(text);

const PLAN = /\b(?:The\s+)?([A-Z][\w-]*)\s+plan\s+(costs|starts at|is priced on request|is priced)\s*(?:at\s*)?([\d,]+)?\s*(?:rupees?)?\s*(per month|a month|per year)?\s*(?:and\s+)?(?:(?:includes?|adds?)\s+)?(.*)$/i;

export function extractPlans(passages: string[]): PlansCard | null {
  const rows: PlanRow[] = [], notes: string[] = [];
  const seen = new Set<string>();
  for (const passage of passages) {
    for (const raw of passage.split(/(?<=[.!?])\s+|\n+/)) {
      const sentence = raw.trim().replace(/\.$/, "");
      if (!sentence) continue;
      const m = PLAN.exec(sentence);
      if (m && /plan/i.test(sentence)) {
        const name = m[1]!, verb = m[2]!.toLowerCase(), amount = m[3];
        if (seen.has(name.toLowerCase())) continue;
        seen.add(name.toLowerCase());
        const price = amount ? `${verb === "starts at" ? "From " : ""}₹${amount}${m[4] ? " / month" : ""}` : "On request";
        rows.push({ name, price, includes: m[5]!.replace(/^(?:and\s+)?/i, "").trim() });
      } else if (/\b(annual|annually|all plans|every plan)\b/i.test(sentence)) {
        if (!notes.includes(sentence)) notes.push(sentence);
      }
    }
  }
  return rows.length >= 2 ? { rows, notes } : null;
}
