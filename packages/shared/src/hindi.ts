/** Numbers in Hindi sentences. The Hindi voice model skips digits entirely, so every number is spelled out in words. */
const ONES = ["शून्य", "एक", "दो", "तीन", "चार", "पाँच", "छह", "सात", "आठ", "नौ", "दस", "ग्यारह", "बारह", "तेरह", "चौदह", "पंद्रह", "सोलह", "सत्रह", "अठारह", "उन्नीस",
  "बीस", "इक्कीस", "बाईस", "तेईस", "चौबीस", "पच्चीस", "छब्बीस", "सत्ताईस", "अट्ठाईस", "उनतीस", "तीस", "इकतीस", "बत्तीस", "तैंतीस", "चौंतीस", "पैंतीस", "छत्तीस", "सैंतीस", "अड़तीस", "उनतालीस",
  "चालीस", "इकतालीस", "बयालीस", "तैंतालीस", "चौवालीस", "पैंतालीस", "छियालीस", "सैंतालीस", "अड़तालीस", "उनचास", "पचास", "इक्यावन", "बावन", "तिरपन", "चौवन", "पचपन", "छप्पन", "सत्तावन", "अट्ठावन", "उनसठ",
  "साठ", "इकसठ", "बासठ", "तिरेसठ", "चौंसठ", "पैंसठ", "छियासठ", "सड़सठ", "अड़सठ", "उनहत्तर", "सत्तर", "इकहत्तर", "बहत्तर", "तिहत्तर", "चौहत्तर", "पचहत्तर", "छिहत्तर", "सतहत्तर", "अठहत्तर", "उन्यासी",
  "अस्सी", "इक्यासी", "बयासी", "तिरासी", "चौरासी", "पचासी", "छियासी", "सतासी", "अट्ठासी", "नवासी", "नब्बे", "इक्यानवे", "बानवे", "तिरानवे", "चौरानवे", "पचानवे", "छियानवे", "सत्तानवे", "अट्ठानवे", "निन्यानवे"];

/** A whole number in Hindi words, using the Indian groups (hazaar, lakh, crore). Up to 99,99,99,999. */
export function hindiNumberWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 9_99_99_99_999) return String(n);
  if (n === 0) return ONES[0]!;
  const parts: string[] = [];
  const crore = Math.floor(n / 1e7), lakh = Math.floor((n % 1e7) / 1e5), thousand = Math.floor((n % 1e5) / 1e3), hundred = Math.floor((n % 1e3) / 100), rest = n % 100;
  if (crore) parts.push(`${ONES[crore]} करोड़`);
  if (lakh) parts.push(`${ONES[lakh]} लाख`);
  if (thousand) parts.push(`${ONES[thousand]} हज़ार`);
  if (hundred) parts.push(`${ONES[hundred]} सौ`);
  if (rest) parts.push(ONES[rest]!);
  return parts.join(" ");
}

const DEVANAGARI_DIGITS = "०१२३४५६७८९";

/** Replaces digits, rupee signs and percentages in a Hindi sentence with words. Text without Devanagari is left alone. */
export function spellOutHindiNumbers(text: string): string {
  if (!/[\u0900-\u097F]/.test(text)) return text;
  return text
    .replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)))
    .replace(/(?:₹|Rs\.?|INR)\s*(\d[\d,]*(?:\.\d+)?)/gi, "$1 रुपये")
    .replace(/(\d[\d,]*(?:\.\d+)?)\s*%/g, "$1 प्रतिशत")
    .replace(/\d[\d,]*(?:\.\d+)?/g, (m) => {
      const [whole, frac] = m.replace(/,/g, "").split(".");
      const w = hindiNumberWords(Number(whole));
      return frac ? `${w} दशमलव ${[...frac].map((d) => ONES[Number(d)]).join(" ")}` : w;
    });
}
