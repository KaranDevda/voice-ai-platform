/**
 * Hinglish sounds foreign when the English words in it are spoken by an English voice: an American "business plan" in the
 * middle of a Hindi sentence. Indian speakers say those words with Hindi sounds ("बिज़नेस प्लान"). So, in a sentence that already
 * has Hindi in it, common English words are written in Devanagari and the whole sentence is spoken by the Hindi voice.
 * Words not listed are left in English letters (and spoken by the English voice), so a rare word may still carry an accent.
 * Sentences without any Hindi are never touched.
 */
const WORDS: Record<string, string> = {
  // the product and its plans
  bizfy: "बिज़्फ़ी", business: "बिज़नेस", plan: "प्लान", plans: "प्लान्स", starter: "स्टार्टर", premium: "प्रीमियम", enterprise: "एंटरप्राइज़",
  basic: "बेसिक", pro: "प्रो", free: "फ़्री", trial: "ट्रायल", demo: "डेमो", unlimited: "अनलिमिटेड", priority: "प्रायोरिटी", onboarding: "ऑनबोर्डिंग",
  single: "सिंगल", sign: "साइन", on: "ऑन", feature: "फ़ीचर", features: "फ़ीचर्स", retention: "रिटेंशन", dashboard: "डैशबोर्ड",
  // calls
  call: "कॉल", calls: "कॉल्स", called: "कॉल्ड", calling: "कॉलिंग", callback: "कॉलबैक", back: "बैक", record: "रिकॉर्ड", recorded: "रिकॉर्डेड",
  recording: "रिकॉर्डिंग", recordings: "रिकॉर्डिंग्स", tracking: "ट्रैकिंग", track: "ट्रैक", transcript: "ट्रांसक्रिप्ट", transcripts: "ट्रांसक्रिप्ट्स",
  summary: "समरी", summaries: "समरीज़", reminder: "रिमाइंडर", reply: "रिप्लाई", message: "मैसेज", line: "लाइन", busy: "बिज़ी", hold: "होल्ड",
  meeting: "मीटिंग", schedule: "शेड्यूल", appointment: "अपॉइंटमेंट", booking: "बुकिंग", book: "बुक",
  // people and things
  user: "यूज़र", users: "यूज़र्स", assistant: "असिस्टेंट", phone: "फ़ोन", mobile: "मोबाइल", app: "ऐप", apps: "ऐप्स", customer: "कस्टमर", team: "टीम",
  manager: "मैनेजर", agent: "एजेंट", lead: "लीड", leads: "लीड्स", account: "अकाउंट", status: "स्टेटस", report: "रिपोर्ट", reports: "रिपोर्ट्स",
  data: "डेटा", security: "सिक्योरिटी", policy: "पॉलिसी", service: "सर्विस", support: "सपोर्ट", website: "वेबसाइट", link: "लिंक", whatsapp: "व्हाट्सऐप",
  email: "ईमेल", number: "नंबर", numbers: "नंबर्स", name: "नेम", details: "डिटेल्स", detail: "डिटेल", login: "लॉगिन", password: "पासवर्ड",
  // money and orders
  price: "प्राइस", offer: "ऑफ़र", discount: "डिस्काउंट", order: "ऑर्डर", payment: "पेमेंट", bill: "बिल", invoice: "इनवॉइस", save: "सेव",
  month: "मंथ", monthly: "मंथली", year: "ईयर", yearly: "ईयरली", annual: "एनुअल", annually: "एनुअली", days: "डेज़", day: "डे",
  // everyday
  help: "हेल्प", time: "टाइम", hello: "हेलो", hi: "हाय", okay: "ओके", ok: "ओके", yes: "यस", no: "नो", please: "प्लीज़", thanks: "थैंक्स", thank: "थैंक",
  you: "यू", sorry: "सॉरी", sir: "सर", madam: "मैडम", welcome: "वेलकम", good: "गुड", morning: "मॉर्निंग", evening: "ईवनिंग", today: "टुडे", tomorrow: "टुमॉरो",
  confirm: "कन्फ़र्म", confirmed: "कन्फ़र्म्ड", sure: "श्योर", right: "राइट", problem: "प्रॉब्लम", issue: "इशू", complaint: "कम्प्लेंट", feedback: "फ़ीडबैक",
  quality: "क्वालिटी", test: "टेस्ट", testing: "टेस्टिंग", setup: "सेटअप", install: "इंस्टॉल", download: "डाउनलोड", upload: "अपलोड", send: "सेंड", share: "शेयर",
  update: "अपडेट", available: "अवेलेबल", include: "इंक्लूड", includes: "इंक्लूड्स",
};

const LETTERS: Record<string, string> = {
  a: "ए", b: "बी", c: "सी", d: "डी", e: "ई", f: "एफ़", g: "जी", h: "एच", i: "आई", j: "जे", k: "के", l: "एल", m: "एम", n: "एन", o: "ओ", p: "पी",
  q: "क्यू", r: "आर", s: "एस", t: "टी", u: "यू", v: "वी", w: "डब्ल्यू", x: "एक्स", y: "वाई", z: "ज़ेड",
};

/** Letters read out one by one, the way Indian speakers say an abbreviation: AI becomes "ए आई". */
const spell = (w: string) => [...w.toLowerCase()].map((c) => LETTERS[c] ?? c).join(" ");

export const hasDevanagari = (t: string) => /[ऀ-ॿ]/.test(t);

export function hinglishToDevanagari(text: string): string {
  if (!hasDevanagari(text)) return text;
  return text.replace(/[A-Za-z]+(?:['’][A-Za-z]+)?/g, (word) => {
    const known = WORDS[word.toLowerCase()];
    if (known) return known;
    if (word.length >= 2 && word.length <= 5 && word === word.toUpperCase() && /^[A-Z]+$/.test(word)) return spell(word); // OTP, CRM, SMS, AI
    return word; // not listed: left as it is
  });
}
