import { detectCallerLanguage } from "./language";

/**
 * Booking a callback or a demo during a call, as a small state machine instead of free chat with the model:
 *  - it collects the caller's name, the day and the time, asking ONE question at a time and only for what is still missing;
 *  - it resolves "today / आज / aaj", "tomorrow / कल / kal", weekday names and "24 November" against today's date in India
 *    (Asia/Kolkata), and asks once when a weekday and a date disagree;
 *  - it understands Hindi and Hinglish times ("दोपहर एक बजे", "1 baje", "साढ़े चार", "शाम 5 बजे", "अभी") and the usual
 *    speech-recognition slips ("एक बज़ेट" for "एक बजे");
 *  - when everything is filled it confirms once in one line and stops asking; a later "make it 2 PM" updates and re-confirms.
 * The caller's name is kept exactly as first heard, so it is never spelled two ways (करन, then करण) in one call.
 */

export type CallLanguage = "en" | "hi" | "en-hi";
export type ReplyLanguage = "en" | "hi" | "hinglish";
type Slot = "name" | "date" | "time";

export interface Booking {
  name: string;
  /** YYYY-MM-DD, India date. */
  date: string;
  /** HH:MM, 24-hour, India time. */
  time: string;
  /** The same moment as an absolute instant. */
  at: Date;
  /** The one-line confirmation the caller heard. */
  confirmation: string;
  language: ReplyLanguage;
  /** True when this replaced an earlier confirmed booking in the same call. */
  changed: boolean;
}

export interface BookingOptions {
  language: CallLanguage;
  now?: () => Date;
  /** Called once per confirmed booking (and again after a change), to save it and tell the team. */
  onBooked?: (b: Booking) => void;
}

const IST_MS = 330 * 60_000;
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
function istNow(now: Date) {
  const t = new Date(now.getTime() + IST_MS);
  return { date: ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()), minutes: t.getUTCHours() * 60 + t.getUTCMinutes(), year: t.getUTCFullYear() };
}
function parseYmd(s: string) { const [y, m, d] = s.split("-").map(Number); return { y: y!, m: m!, d: d! }; }
function addDays(s: string, n: number): string {
  const { y, m, d } = parseYmd(s);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
const weekdayOf = (s: string) => { const { y, m, d } = parseYmd(s); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const validDay = (y: number, m: number, d: number) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };
/** The absolute instant of an India date and time. */
export function istInstant(date: string, time: string): Date {
  const { y, m, d } = parseYmd(date);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh!, mm!) - IST_MS);
}

// ---------- words ----------
const WEEKDAYS_EN = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_EN_RE: Array<[RegExp, number]> = [
  [/\bsun(day)?\b/i, 0], [/\bmon(day)?\b/i, 1], [/\btue(s|sday)?\b/i, 2], [/\bwed(nesday)?\b/i, 3], [/\bthu(r|rs|rsday)?\b/i, 4], [/\bfri(day)?\b/i, 5], [/\bsat(urday)?\b/i, 6],
];
const WEEKDAYS_HI = ["रविवार", "सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार"];
const WEEKDAY_HI_WORDS: Array<[string[], number]> = [
  [["रविवार", "इतवार", "संडे"], 0], [["सोमवार", "मंडे"], 1], [["मंगलवार", "मंगल", "ट्यूज़डे", "ट्यूजडे", "ट्यूस्डे", "ट्यूसडे"], 2], [["बुधवार", "वेडनेसडे"], 3],
  [["गुरुवार", "बृहस्पतिवार", "वीरवार", "थर्सडे"], 4], [["शुक्रवार", "फ्राइडे", "फ़्राइडे"], 5], [["शनिवार", "सैटरडे"], 6],
];
const WEEKDAY_LATIN: Array<[RegExp, number]> = [
  [/\b(ravivar|raviwar|itvar|itwar)\b/i, 0], [/\b(somvar|somwar|somvaar)\b/i, 1], [/\b(mangalvar|mangalwar|mangalvaar)\b/i, 2], [/\b(budhvar|budhwar)\b/i, 3],
  [/\b(guruvar|guruwar|brihaspativar|veervar)\b/i, 4], [/\b(shukravar|shukrawar|sukravar)\b/i, 5], [/\b(shanivar|shaniwar)\b/i, 6],
];
const MONTHS_EN = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_EN_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const monthIndexEn = (w: string) => MONTHS_EN.findIndex((m) => m.startsWith(w.toLowerCase().slice(0, 3))) + 1;
const MONTHS_HI = ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर", "नवंबर", "दिसंबर"];
const MONTH_HI_WORDS: Array<[string[], number]> = [
  [["जनवरी"], 1], [["फ़रवरी", "फरवरी"], 2], [["मार्च"], 3], [["अप्रैल", "अप्रेल"], 4], [["मई"], 5], [["जून"], 6], [["जुलाई"], 7], [["अगस्त"], 8],
  [["सितंबर", "सितम्बर", "सेप्टेंबर"], 9], [["अक्टूबर", "अक्तूबर", "ऑक्टोबर"], 10], [["नवंबर", "नवम्बर", "नवेंबर", "नोवेंबर", "नोवेम्बर"], 11], [["दिसंबर", "दिसम्बर", "दिसेंबर", "डिसेंबर"], 12],
];

/** Hindi and Hinglish number words, 1 to 31 (dates and hours). */
const NUM_HI: Record<string, number> = {
  "एक": 1, "दो": 2, "तीन": 3, "चार": 4, "पाँच": 5, "पांच": 5, "छह": 6, "छः": 6, "छे": 6, "सात": 7, "आठ": 8, "नौ": 9, "दस": 10, "ग्यारह": 11, "बारह": 12,
  "तेरह": 13, "चौदह": 14, "पंद्रह": 15, "पन्द्रह": 15, "सोलह": 16, "सत्रह": 17, "अठारह": 18, "उन्नीस": 19, "बीस": 20, "इक्कीस": 21, "बाईस": 22, "तेईस": 23,
  "चौबीस": 24, "पच्चीस": 25, "छब्बीस": 26, "सत्ताईस": 27, "अट्ठाईस": 28, "अठ्ठाईस": 28, "उनतीस": 29, "तीस": 30, "इकतीस": 31,
  // Spellings speech-to-text often writes instead.
  "इक्किस": 21, "बाइस": 22, "तेइस": 23, "चोबीस": 24, "चौबिस": 24, "पचीस": 25, "पच्चिस": 25, "छब्बिस": 26, "सत्ताइस": 27, "अठाईस": 28, "उन्तीस": 29, "इकत्तीस": 31,
};
const NUM_LATIN: Record<string, number> = {
  ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, chhah: 6, saat: 7, sat: 7, aath: 8, aat: 8, nau: 9, das: 10, dus: 10,
  gyarah: 11, gyaarah: 11, barah: 12, baarah: 12,
};
const NUM_EN: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const toAsciiDigits = (s: string) => s.replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x0966));
const hiTokens = (s: string) => s.split(/[\s,।.!?;:"'()\-]+/).filter(Boolean);

function numberWord(w: string): number | undefined {
  if (/^\d{1,2}$/.test(w)) return Number(w);
  return NUM_HI[w] ?? NUM_LATIN[w.toLowerCase()] ?? NUM_EN[w.toLowerCase()];
}

// ---------- intent ----------
// "meeting" alone is not a request ("does it include meeting transcripts?"): only with a verb ("schedule a meeting", "I want a meeting").
const INTENT_EN = /\b(demo|call ?back|appointment|call me\b|(?:connect|put|transfer)\s+me\s+(?:with|to)\s+(?:the|your|a)?\s*(?:team|someone|sales)|(?:talk|speak)\s+(?:to|with)\s+(?:the|your|a)?\s*(?:team|someone|sales)|team\s+(?:to\s+)?call|(?:schedule|book|arrange|set ?up|fix|want|need|like)\s+(?:a|an|the|my|one)?\s*(?:call|slot|time|demo|meeting))/i;
// Speech-to-text spells "schedule" several ways in Devanagari (शेड्यूल, शेडिूल, शेड्युल, शेडूल): any word "शेड…ल" counts.
const INTENT_HI = /(डेमो|मीटिंग (?:चाहिए|फिक्स|करनी|करना|करवा|रख|बुक)|कॉल ?बैक|अपॉइंटमेंट|अपोइंटमेंट|शे[डड़]\S*ल|बुक कर|(?:कॉल|फ़ोन|फोन) (?:करवा|करवाइए|करवाना|करवानी|कर दीजिए|कर दो|कीजिए|करना|करनी|चाहिए|बुक))/;
const INTENT_LATIN = /\b(demo|meeting (?:chahiye|fix|karni|karna|karwa|rakh)|callback|call back|call (?:karwa|karva|karwao|kar do|kar dijiye|kijiye|chahiye)|schedule|book (?:kar|karo|kijiye))\b/i;
export const isBookingIntent = (t: string) => INTENT_EN.test(t) || INTENT_HI.test(t) || INTENT_LATIN.test(t);

const CANCEL = /^(?:no|nope|cancel(?: it)?|never ?mind|not now|leave it|no thanks?|nahi|nahin|rehne do|mat karo)[.! ]*$|^(?:नहीं|नही|रहने दो|रहने दीजिए|नहीं चाहिए|मत कीजिए|कैंसल)[\s।.!]*$/i;
const YES = /^(?:yes|yeah|yep|sure|ok(?:ay)?|correct|right|haan|han|ji|ji haan|theek hai|thik hai|हाँ|हां|जी|जी हाँ|जी हां|ठीक है|सही है|बिल्कुल)[\s,.!।]*(?:please|ji|जी)?[\s.!।]*$/i;

// ---------- slots ----------
const NOT_A_NAME = new Set(["today", "tomorrow", "fine", "good", "looking", "interested", "calling", "here", "ok", "okay", "sure", "yes", "no", "not", "just", "the", "a",
  "आज", "कल", "ठीक", "हाँ", "हां", "जी", "नहीं", "बस", "हूँ", "हूं", "है", "aaj", "kal", "theek", "haan", "ji", "nahi", ...WEEKDAYS_EN, ...MONTHS_EN, ...WEEKDAYS_HI]);
const NAME_TAIL = /\s+(?:है|हैं|हूँ|हूं|जी|ही|hai|hain|hoon|hu|hun|ji|here|speaking)$/i;
const tidyName = (raw: string) => {
  let n = raw.trim().replace(/[.,!?।]+$/u, "");
  for (let i = 0; i < 2; i++) n = n.replace(NAME_TAIL, "").trim();
  return /[A-Za-z]/.test(n) ? n.split(/\s+/).map((w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase()).join(" ") : n;
};
function findName(text: string, bareAllowed: boolean): string | undefined {
  const patterns = [
    /\b(?:my name is|my name's|name is|this is|i am|i'm)\s+([A-Za-z][A-Za-z'.-]+(?:\s+[A-Za-z][A-Za-z'.-]+)?)/i,
    /(?:मेरा नाम|मेरा नेम|मेरा शुभ नाम|नाम)\s*(?:है\s+)?[:\-]?\s*([ऀ-ॿ]+(?:\s+[ऀ-ॿ]+)?)/u,
    /मैं\s+([ऀ-ॿ]+(?:\s+[ऀ-ॿ]+)?)\s+(?:हूँ|हूं|बोल)/u,
    /\b(?:mera naam|mera name|naam)\s+(?:hai\s+)?([a-z]+(?:\s+[a-z]+)?)/i,
    /\bmain\s+([a-z]+)\s+(?:hoon|hu|hun|bol)/i,
    // "a call for Karan": only a capitalised word (the recogniser capitalises names), so "for tomorrow" is never a name.
    /\bfor\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/,
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    if (!m) continue;
    const n = tidyName(m[1]!);
    const first = n.split(/\s+/)[0]!.toLowerCase();
    if (n && !NOT_A_NAME.has(first) && !numberWord(first)) return n;
  }
  if (!bareAllowed) return undefined;
  // The answer to "What is your name?" is often just the name ("Karan.", "जी, करन").
  const bare = text.replace(/[.,!?।]/gu, " ").replace(/^\s*(?:जी|हाँ|हां|ji|haan|yes|sure|okay|ok|it's|its|it is)\s+/iu, "").trim();
  const words = bare.split(/\s+/).filter(Boolean);
  if (words.length >= 1 && words.length <= 3 && !/\d/.test(bare) && !words.some((w) => NOT_A_NAME.has(w.toLowerCase()))) return tidyName(bare);
  return undefined;
}

interface DateFound { date?: string; weekday?: number; explicitDate?: string }
function findDate(raw: string, today: string): DateFound {
  const text = toAsciiDigits(raw);
  const lower = text.toLowerCase();
  const tokens = hiTokens(text);
  const has = (words: string[]) => tokens.some((t) => words.includes(t));
  const out: DateFound = {};
  const { y: thisYear } = parseYmd(today);
  const pick = (m: number, d: number) => {
    if (!validDay(thisYear, m, d)) return undefined;
    let s = ymd(thisYear, m, d);
    if (s < today) s = validDay(thisYear + 1, m, d) ? ymd(thisYear + 1, m, d) : s;
    return s;
  };
  // An explicit day and month: "24 November", "24th of Nov", "November 24", "24 नवंबर", "चौबीस नवंबर", "24/11".
  let m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?${MONTH_EN_RE}\\b`, "i").exec(text);
  if (m) out.explicitDate = pick(monthIndexEn(m[2]!), Number(m[1]));
  if (!out.explicitDate && (m = new RegExp(`\\b${MONTH_EN_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i").exec(text))) out.explicitDate = pick(monthIndexEn(m[1]!), Number(m[2]));
  if (!out.explicitDate) {
    for (let i = 0; i < tokens.length && !out.explicitDate; i++) {
      const month = MONTH_HI_WORDS.find(([w]) => w.includes(tokens[i]!))?.[1];
      if (!month || i === 0) continue;
      const day = numberWord(tokens[i - 1]!.replace(/(?:st|nd|rd|th)$/i, ""));
      if (day) out.explicitDate = pick(month, day);
    }
  }
  if (!out.explicitDate && (m = /\b(\d{1,2})[/-](\d{1,2})\b/.exec(text))) out.explicitDate = pick(Number(m[2]), Number(m[1]));
  // Relative days. "कल" means tomorrow when booking something in the future.
  if (/\bday after tomorrow\b|\bparso\b|\bparson\b/i.test(lower) || has(["परसों", "परसो"])) out.date = addDays(today, 2);
  else if (/\btomorrow\b|\bkal\b/i.test(lower) || has(["कल"])) out.date = addDays(today, 1);
  else if (/\btoday\b|\baaj\b|\bright now\b|\babhi\b/i.test(lower) || has(["आज", "अभी"])) out.date = today;
  // A weekday: the nearest one from today (today itself counts), or the one after with "next" / "अगले".
  let wd: number | undefined;
  for (const [re, d] of [...WEEKDAY_EN_RE, ...WEEKDAY_LATIN]) if (re.test(text)) { wd = d; break; }
  if (wd === undefined) for (const [words, d] of WEEKDAY_HI_WORDS) if (has(words)) { wd = d; break; }
  if (wd !== undefined) {
    out.weekday = wd;
    const next = /\bnext\b|\bagle\b|\baglे?\b/i.test(lower) || has(["अगले", "अगला"]);
    let delta = (wd - weekdayOf(today) + 7) % 7;
    if (next && delta === 0) delta = 7;
    if (!out.date) out.date = addDays(today, delta);
  }
  if (out.explicitDate) out.date = out.explicitDate;
  return out;
}

interface TimeFound { minutes?: number; now?: boolean }
function findTime(raw: string, expectingTime: boolean, nowMinutes: number): TimeFound {
  const text = toAsciiDigits(raw).replace(/बज़ेट|बजेट|बज़े|बजट|बजा|बज़/gu, "बजे"); // speech-recognition slips for "बजे"
  const lower = text.toLowerCase();
  const tokens = hiTokens(text);
  if (/\b(right now|now|abhi|immediately)\b/i.test(lower) || tokens.includes("अभी")) {
    const soon = Math.ceil((nowMinutes + 15) / 15) * 15;
    return { minutes: soon, now: true };
  }
  let hour: number | undefined, minute = 0, ampm: "am" | "pm" | undefined;
  let period: "morning" | "noon" | "evening" | "night" | undefined;
  if (/\b(morning|subah|subha|savere)\b/i.test(lower) || tokens.some((t) => ["सुबह", "सवेरे"].includes(t))) period = "morning";
  else if (/\b(afternoon|dopahar|dopehar|dopher|dupahar)\b/i.test(lower) || tokens.some((t) => ["दोपहर", "दुपहर"].includes(t))) period = "noon";
  else if (/\b(evening|shaam|sham)\b/i.test(lower) || tokens.includes("शाम")) period = "evening";
  else if (/\b(night|raat)\b/i.test(lower) || tokens.includes("रात")) period = "night";
  let m = /\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)/i.exec(text);
  if (m) { hour = Number(m[1]); minute = Number(m[2] ?? 0); ampm = /^a/i.test(m[3]!) ? "am" : "pm"; }
  if (hour === undefined && /\b(noon|midday)\b/i.test(lower)) { hour = 12; ampm = "pm"; }
  if (hour === undefined && (m = /\bhalf past (\d{1,2}|[a-z]+)\b/i.exec(text))) { const h = numberWord(m[1]!); if (h) { hour = h; minute = 30; } }
  if (hour === undefined && (m = /\b(\d{1,2}|[a-z]+)(?:[:.](\d{2}))?\s*o'?\s?clock\b/i.exec(text))) { const h = numberWord(m[1]!); if (h) { hour = h; minute = Number(m[2] ?? 0); } }
  if (hour === undefined) {
    // Hindi and Hinglish: "[सुबह|दोपहर|शाम|रात] [साढ़े|सवा|पौने] <number or डेढ़|ढाई> [:mm] बजे", "1 baje", "saade chaar baje".
    const words = text.split(/\s+/).map((w) => w.replace(/[.,!?।]+$/u, ""));
    for (let i = 0; i < words.length; i++) {
      const w = words[i]!, wl = w.toLowerCase();
      if (!(w === "बजे" || w === "बजकर" || /^(baje|bje|bajey|baj|bajkar)$/i.test(wl))) continue;
      let j = i - 1;
      let hm = /^(\d{1,2})[:.](\d{2})$/.exec(words[j] ?? "");
      let h: number | undefined, mm = 0;
      if (hm) { h = Number(hm[1]); mm = Number(hm[2]); }
      else {
        const prev = words[j] ?? "", pl = prev.toLowerCase();
        if (["डेढ़", "डेढ"].includes(prev) || pl === "dedh") { h = 1; mm = 30; }
        else if (["ढाई"].includes(prev) || ["dhai", "dhaai", "dhayi"].includes(pl)) { h = 2; mm = 30; }
        else h = numberWord(prev);
        const before = (words[j - 1] ?? "").toLowerCase();
        if (h && ["साढ़े", "साढे", "sadhe", "saadhe", "saade", "sade"].includes(before)) mm = 30;
        else if (h && ["सवा", "sava", "sawa"].includes(before)) mm = 15;
        else if (h && ["पौने", "paune", "pone"].includes(before)) { mm = 45; h = h === 1 ? 12 : h - 1; }
      }
      if (h) { hour = h; minute = mm; break; }
    }
  }
  if (hour === undefined && expectingTime) {
    // A bare answer to "What time?": "1", "एक", "at 4", "4:30".
    m = /^(?:at\s+)?(\d{1,2}|[a-zऀ-ॿ]+)(?:[:.](\d{2}))?[\s.!।]*$/iu.exec(text.trim());
    if (m) { const h = numberWord(m[1]!); if (h && h <= 12) { hour = h; minute = Number(m[2] ?? 0); } }
    if (hour === undefined && (m = /\bat\s+(\d{1,2})(?:[:.](\d{2}))?\b/i.exec(text))) { hour = Number(m[1]); minute = Number(m[2] ?? 0); }
  }
  if (hour === undefined || hour > 23 || minute > 59) return {};
  // Morning or afternoon? A marker decides; without one, 1 to 7 is the afternoon or evening and 8 to 11 the morning (office hours).
  let h24 = hour;
  if (ampm === "am") h24 = hour % 12;
  else if (ampm === "pm") h24 = (hour % 12) + 12;
  else if (hour <= 12) {
    if (period === "morning") h24 = hour % 12;
    else if (period === "noon") h24 = hour === 12 ? 12 : hour + 12;
    else if (period === "evening" || period === "night") h24 = hour === 12 ? 0 : hour + 12;
    else h24 = hour === 12 ? 12 : hour <= 7 ? hour + 12 : hour;
  }
  return { minutes: h24 * 60 + minute };
}

// ---------- speaking ----------
function formatDay(date: string, lang: ReplyLanguage): string {
  const { m, d } = parseYmd(date);
  const wd = weekdayOf(date);
  if (lang === "hi") return `${WEEKDAYS_HI[wd]} ${d} ${MONTHS_HI[m - 1]}`;
  const name = WEEKDAYS_EN[wd]!;
  return `${name[0]!.toUpperCase()}${name.slice(1)}, ${d} ${MONTHS_EN[m - 1]![0]!.toUpperCase()}${MONTHS_EN[m - 1]!.slice(1)}`;
}
function formatTime(minutes: number, lang: ReplyLanguage): string {
  const h24 = Math.floor(minutes / 60), mm = minutes % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const clock = mm ? `${h12}:${pad(mm)}` : `${h12}`;
  if (lang === "hi") {
    const part = h24 < 12 ? (h24 < 4 ? "रात" : "सुबह") : h24 < 16 ? "दोपहर" : h24 < 20 ? "शाम" : "रात";
    return `${part} ${clock} बजे`;
  }
  return `${clock} ${h24 < 12 ? "AM" : "PM"}`;
}
const honorific = (name: string, lang: ReplyLanguage) => (lang === "en" ? name : `${name} जी`);

const LINES = {
  askName: { en: "Sure, I can arrange that. May I have your name?", hi: "जी ज़रूर, मैं arrange कर देता हूँ। आपका नाम क्या है?", hinglish: "जी ज़रूर, मैं arrange कर देता हूँ। आपका नाम क्या है?" },
  askNameAgain: { en: "Sorry, I didn't catch your name. Could you say it once more?", hi: "माफ़ कीजिए, नाम ठीक से सुनाई नहीं दिया। एक बार फिर बताइए?", hinglish: "Sorry, नाम ठीक से सुनाई नहीं दिया। एक बार फिर बताइए?" },
  askDate: (n: string | undefined, l: ReplyLanguage) => l === "en" ? `${n ? `Thanks, ${n}. ` : ""}Which day suits you?` : `${n ? `धन्यवाद ${honorific(n, l)}। ` : ""}${l === "hi" ? "आपको किस दिन call चाहिए?" : "किस दिन call करें?"}`,
  askDateAgain: { en: "Which day would you like? For example today, tomorrow or Tuesday.", hi: "कौन सा दिन रखें? जैसे आज, कल या मंगलवार।", hinglish: "कौन सा दिन रखें? जैसे आज, कल या Tuesday।" },
  askTime: (day: string, l: ReplyLanguage) => l === "en" ? `And what time on ${day}?` : l === "hi" ? `${day} को किस समय?` : `${day} को किस time पर?`,
  askTimeAgain: { en: "What time works for you? For example 11 AM or 4 PM.", hi: "किस समय रखें? जैसे सुबह 11 बजे या शाम 4 बजे।", hinglish: "किस time रखें? जैसे 11 AM या 4 PM।" },
  pastDate: { en: "That date has already passed. Which day would suit you?", hi: "वह तारीख निकल चुकी है। कौन सा दिन रखें?", hinglish: "वह date निकल चुकी है। कौन सा दिन रखें?" },
  pastTime: { en: "That time has already passed today. What time would suit you?", hi: "आज वह समय निकल चुका है। कौन सा समय रखें?", hinglish: "आज वह time निकल चुका है। कौन सा time रखें?" },
  conflict: (said: number, date: string, l: ReplyLanguage) => {
    const real = formatDay(date, l);
    return l === "en"
      ? `Just to check: ${real.split(", ")[1]} is a ${formatDay(date, "en").split(",")[0]}, not a ${WEEKDAYS_EN[said]![0]!.toUpperCase()}${WEEKDAYS_EN[said]!.slice(1)}. Shall I keep ${real}?`
      : `एक बात: ${real.split(" ").slice(1).join(" ")} को ${WEEKDAYS_HI[weekdayOf(date)]} है, ${WEEKDAYS_HI[said]} नहीं। क्या ${real} रख दूँ?`;
  },
  confirm: (b: { name: string; date: string; minutes: number }, l: ReplyLanguage) => {
    const day = formatDay(b.date, l === "hinglish" ? "en" : l).replace(",", "");
    const time = formatTime(b.minutes, l === "hinglish" ? "en" : l);
    if (l === "en") return `Done, ${b.name}: ${formatDay(b.date, "en")} at ${time}. The team will confirm it with a meeting link.`;
    return `ठीक है ${honorific(b.name, l)}, ${day}, ${time}। Team meeting link के साथ confirm करेगी।`;
  },
  cancelled: { en: "No problem, I won't book anything. Is there anything else I can help with?", hi: "कोई बात नहीं, मैं कुछ book नहीं कर रहा हूँ। और कुछ मदद चाहिए?", hinglish: "No problem, मैं कुछ book नहीं कर रहा हूँ। और कुछ help चाहिए?" },
  giveUp: { en: "No problem. Our team will call you to fix a time that suits you.", hi: "कोई बात नहीं। हमारी team आपको call करके समय तय कर लेगी।", hinglish: "No problem. हमारी team आपको call करके time fix कर लेगी।" },
};

/** The booking state for one call. */
export class BookingFlow {
  private stage: "idle" | "collecting" | "confirmed" = "idle";
  private name?: string;
  private date?: string;
  private minutes?: number;
  private asked: Slot | "conflict" | null = null;
  private conflict?: { said: number; date: string };
  private misses = 0;
  private lastLang: ReplyLanguage;
  private readonly now: () => Date;

  constructor(private readonly o: BookingOptions) {
    this.now = o.now ?? (() => new Date());
    this.lastLang = o.language === "hi" ? "hi" : o.language === "en" ? "en" : "hinglish";
  }

  get active(): boolean { return this.stage === "collecting"; }
  get confirmed(): boolean { return this.stage === "confirmed"; }
  /** The caller's name as first heard, for the model's note, so it never spells it differently. */
  get callerName(): string | undefined { return this.name; }

  /** The language to reply in for this caller line: fixed for English and Hindi calls, the caller's own mix on a mixed call. */
  private replyLanguage(text: string): ReplyLanguage {
    if (this.o.language === "en") return "en";
    if (this.o.language === "hi") return "hi";
    const d = detectCallerLanguage(text);
    if (d) this.lastLang = d;
    return this.lastLang;
  }

  /** A note for the model while a booking is open or done, so it never asks for the name, day or time itself. */
  modelNote(): string {
    const parts: string[] = [];
    if (this.name) parts.push(`caller's name: ${this.name} (write it exactly like this)`);
    if (this.stage === "confirmed" && this.date && this.minutes !== undefined) parts.push(`callback already booked for ${formatDay(this.date, "en")} at ${formatTime(this.minutes, "en")}; do not ask for a name, day or time again`);
    else if (this.stage === "collecting") parts.push("a callback booking is in progress; the system asks for the name, day and time, so do not ask for them yourself");
    return parts.join("; ");
  }

  /** After the model answered something else in the middle of a booking, the question that is still open. */
  pendingQuestion(text: string): string | null {
    if (this.stage !== "collecting") return null;
    const l = this.replyLanguage(text);
    return this.question(this.missing() ?? "time", l, false);
  }

  private missing(): Slot | null {
    if (!this.name) return "name";
    if (!this.date) return "date";
    if (this.minutes === undefined) return "time";
    return null;
  }

  private question(slot: Slot, l: ReplyLanguage, again: boolean): string {
    this.asked = slot;
    if (slot === "name") return again ? LINES.askNameAgain[l] : LINES.askName[l];
    if (slot === "date") return again ? LINES.askDateAgain[l] : LINES.askDate(this.name, l);
    return again ? LINES.askTimeAgain[l] : LINES.askTime(formatDay(this.date!, l === "hinglish" ? "en" : l), l);
  }

  /**
   * Handles one caller line. Returns the line to say when the booking flow answers it, or null to let the model answer
   * (not about booking, or a question in the middle of one: the open question is asked again after the model's answer).
   */
  handle(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const intent = isBookingIntent(trimmed);
    if (this.stage === "idle" && !intent) return null;
    const l = this.replyLanguage(trimmed);
    const { date: today, minutes: nowMinutes } = istNow(this.now());

    if (this.stage === "collecting" && this.asked !== "conflict" && CANCEL.test(trimmed)) {
      this.reset();
      return LINES.cancelled[l];
    }

    // The answer to "Shall I keep <date>?"
    let resolved = false;
    if (this.stage === "collecting" && this.asked === "conflict" && this.conflict) {
      const found = findDate(trimmed, today);
      if (found.date) { this.date = found.date; this.conflict = undefined; resolved = true; }
      else if (YES.test(trimmed)) { this.date = this.conflict.date; this.conflict = undefined; resolved = true; }
      else if (CANCEL.test(trimmed)) { this.conflict = undefined; this.date = undefined; return this.question("date", l, true); }
      else { this.date = this.conflict.date; this.conflict = undefined; resolved = true; }
      this.asked = null;
    }

    const wasConfirmed = this.stage === "confirmed";
    const found = this.absorb(trimmed, today, nowMinutes);
    if (wasConfirmed) {
      // After the confirmation only a new day or time is ours; anything else is for the model.
      if (!found.date && !found.time) return null;
    } else if (this.stage === "idle") this.stage = "collecting";

    if (found.conflict) { this.asked = "conflict"; this.conflict = found.conflict; return LINES.conflict(found.conflict.said, found.conflict.date, l); }
    if (found.pastDate) { this.date = undefined; return this.question("date", l, false) && LINES.pastDate[l]; }
    if (this.date === today && this.minutes !== undefined && this.minutes <= nowMinutes) { this.minutes = undefined; this.asked = "time"; return LINES.pastTime[l]; }

    const missing = this.missing();
    if (missing) {
      const gotSomething = resolved || found.name || found.date || found.time;
      // Nothing usable in an answer to our question: a question of their own goes to the model; otherwise ask again, twice at most.
      if (!gotSomething && this.asked && !intent) {
        if (/\?|\b(what|how|why|which|kya|kitna|kaise)\b|क्या|कितन|कैसे|कौन/i.test(trimmed)) return null;
        if (++this.misses >= 3) { this.reset(); return LINES.giveUp[l]; }
        return this.question(missing, l, true);
      }
      return this.question(missing, l, false);
    }

    this.stage = "confirmed";
    this.asked = null;
    this.misses = 0;
    const booking = { name: this.name!, date: this.date!, minutes: this.minutes! };
    const confirmation = LINES.confirm(booking, l);
    const time = `${pad(Math.floor(booking.minutes / 60))}:${pad(booking.minutes % 60)}`;
    this.o.onBooked?.({ name: booking.name, date: booking.date, time, at: istInstant(booking.date, time), confirmation, language: l, changed: wasConfirmed });
    return confirmation;
  }

  /** Takes whatever slots this line fills. The name is only taken once, so its spelling never changes. */
  private absorb(text: string, today: string, nowMinutes: number) {
    const out: { name?: boolean; date?: boolean; time?: boolean; pastDate?: boolean; conflict?: { said: number; date: string } } = {};
    if (!this.name && this.stage !== "confirmed") {
      const n = findName(text, this.asked === "name");
      if (n) { this.name = n; out.name = true; }
    }
    const d = findDate(text, today);
    if (d.date) {
      if (d.date < today) out.pastDate = true;
      else {
        if (d.explicitDate && d.weekday !== undefined && weekdayOf(d.explicitDate) !== d.weekday) out.conflict = { said: d.weekday, date: d.explicitDate };
        else { this.date = d.date; out.date = true; }
      }
    }
    const t = findTime(text, this.asked === "time" || (this.stage === "confirmed"), nowMinutes);
    if (t.minutes !== undefined) {
      this.minutes = t.minutes; out.time = true;
      if (t.now && !this.date) { this.date = today; out.date = true; }
    }
    if (out.name || out.date || out.time) this.misses = 0;
    return out;
  }

  private reset() {
    this.stage = "idle"; this.asked = null; this.conflict = undefined; this.misses = 0;
    this.date = undefined; this.minutes = undefined; // the name is kept: it is still the same caller
  }
}

/** For the model's note: today's day, date and time in India, so it never has to ask what day it is. */
export function todayNote(now: Date = new Date()): string {
  const { date, minutes } = istNow(now);
  return `today: ${formatDay(date, "en")} ${parseYmd(date).y}, ${formatTime(minutes - (minutes % 5), "en")} India time`;
}

// ---------- goodbye ----------
const CLOSING_EN = /^(?:(?:ok(?:ay)?|alright|great|perfect|cool|fine)[,!.\s]+)?(?:thanks?(?: a lot| so much)?|thank you(?: so much| very much)?|bye|goodbye|good bye|take care|that'?s all|that is all|have a (?:good|nice|great) day)(?:[,!.\s]+(?:thanks?|thank you|bye|goodbye|take care|that'?s all|have a (?:good|nice|great) day))*[\s.!]*$/i;
const CLOSING_LATIN = /^(?:(?:ok(?:ay)?|theek hai|thik hai|accha|achha)[,!.\s]+)?(?:dhanyavaad|dhanyavad|dhanyawad|shukriya|thanks?|thank you|bye|alvida)(?:[,!.\s]+(?:ji|bye|dhanyavaad|shukriya))*[\s.!]*$/i;
const CLOSING_HI = /^(?:(?:ठीक है|अच्छा|ओके|बढ़िया)[,।!\s]+)?(?:धन्यवाद|शुक्रिया|थैंक यू|थैंक्यू|थैंक्स|बाय|अलविदा|टेक केयर)(?:[,।!\s]+(?:जी|बाय|धन्यवाद|शुक्रिया|टेक केयर))*[\s।.!]*$/u;
export const isClosing = (text: string) => { const t = text.trim(); return !!t && (CLOSING_EN.test(t) || CLOSING_LATIN.test(t) || CLOSING_HI.test(t)); };

/** One short goodbye in the caller's language (never repeated filler lines). */
export function goodbyeFor(text: string, session: CallLanguage, previous?: string): string {
  const l: ReplyLanguage = session === "en" ? "en" : session === "hi" ? "hi" : (detectCallerLanguage(text) ?? (previous ? detectCallerLanguage(previous) : undefined) ?? "en");
  if (l === "en") return "You're welcome! Our team will call you soon to take this forward. Have a great day.";
  if (l === "hi") return "धन्यवाद! हमारी team जल्दी ही आपको call करेगी। आपका दिन शुभ हो।";
  return "Thank you! हमारी team जल्दी ही आपको call करेगी। आपका दिन अच्छा रहे।";
}
