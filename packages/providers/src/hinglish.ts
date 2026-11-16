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
  // casual Hinglish
  hey: "हे", life: "लाइफ़", weekend: "वीकेंड", scene: "सीन", seriously: "सीरियसली", we: "वी", need: "नीड", catch: "कैच", up: "अप", soon: "सून", 
  really: "रियली", actually: "एक्चुअली", basically: "बेसिकली", simple: "सिंपल", easy: "ईज़ी", party: "पार्टी",
  lunch: "लंच", dinner: "डिनर", coffee: "कॉफ़ी", movie: "मूवी", trip: "ट्रिप", office: "ऑफ़िस", work: "वर्क", late: "लेट", early: "अर्ली", ready: "रेडी",
  idea: "आइडिया", fine: "फ़ाइन", great: "ग्रेट", nice: "नाइस", super: "सुपर", cool: "कूल", perfect: "परफ़ेक्ट", important: "इम्पॉर्टेंट", urgent: "अर्जेंट",
  meet: "मीट", text: "टेक्स्ट", check: "चेक", wait: "वेट",
};

/**
 * Hindi written in English letters ("Kafi time se baat nahi hui"), the way people type it. Each word is given in Devanagari so the
 * Hindi voice says it correctly; English words in the same sentence use the table above. Spellings vary, so common variants are listed.
 */
const ROMAN_HINDI: Record<string, string> = {
  hai: "है", hain: "हैं", h: "है", ho: "हो", hoon: "हूँ", hu: "हूँ", hun: "हूँ", tha: "था", thi: "थी", the: "थे", hua: "हुआ", hui: "हुई", hue: "हुए", hota: "होता", hoti: "होती", hote: "होते",
  nahi: "नहीं", nahin: "नहीं", nhi: "नहीं", na: "ना", mat: "मत", haan: "हाँ", han: "हाँ", ji: "जी", accha: "अच्छा", acha: "अच्छा", achha: "अच्छा", theek: "ठीक", thik: "ठीक",
  kya: "क्या", kyu: "क्यों", kyun: "क्यों", kyon: "क्यों", kaise: "कैसे", kaisa: "कैसा", kaisi: "कैसी", kab: "कब", kahan: "कहाँ", kaun: "कौन", kitna: "कितना", kitne: "कितने", kitni: "कितनी", kaunsa: "कौनसा", kuch: "कुछ", koi: "कोई", kaha: "कहाँ", kahin: "कहीं",
  main: "मैं", mai: "मैं", mujhe: "मुझे", mera: "मेरा", meri: "मेरी", mere: "मेरे", hum: "हम", humein: "हमें", hume: "हमें", humara: "हमारा", hamara: "हमारा", hamari: "हमारी", tum: "तुम", tumhe: "तुम्हें", tumhein: "तुम्हें", tumhara: "तुम्हारा", tumhari: "तुम्हारी", tumhare: "तुम्हारे",
  tu: "तू", tera: "तेरा", teri: "तेरी", tujhe: "तुझे", aap: "आप", aapka: "आपका", aapki: "आपकी", aapke: "आपके", aapko: "आपको", woh: "वो", wo: "वो", vo: "वो", yeh: "यह", ye: "ये", yah: "यह", unka: "उनका", unki: "उनकी", unko: "उनको", usne: "उसने", usko: "उसको", isko: "इसको", inko: "इनको", apna: "अपना", apni: "अपनी", apne: "अपने", khud: "खुद",
  ka: "का", ki: "की", ke: "के", ko: "को", se: "से", mein: "में", me: "में", usme: "उसमें", par: "पर", pe: "पे", tak: "तक", liye: "लिए", lie: "लिए", sath: "साथ", saath: "साथ", bina: "बिना", baare: "बारे", bare: "बारे",
  aur: "और", ya: "या", lekin: "लेकिन", magar: "मगर", toh: "तो", tho: "तो", bhi: "भी", hi: "ही", sirf: "सिर्फ़", bas: "बस", agar: "अगर", jab: "जब", tab: "तब", jaise: "जैसे", isliye: "इसलिए", kyunki: "क्योंकि", phir: "फिर", fir: "फिर", ab: "अब", abhi: "अभी", pehle: "पहले", baad: "बाद", jaldi: "जल्दी", der: "देर", kabhi: "कभी", hamesha: "हमेशा", roz: "रोज़", aaj: "आज", kal: "कल", parso: "परसों", subah: "सुबह", shaam: "शाम", raat: "रात", din: "दिन", hafta: "हफ़्ता", mahina: "महीना", saal: "साल",
  kafi: "काफ़ी", bahut: "बहुत", bohot: "बहुत", zyada: "ज़्यादा", jyada: "ज़्यादा", thoda: "थोड़ा", thodi: "थोड़ी", thode: "थोड़े", kam: "कम", poora: "पूरा", pura: "पूरा", sab: "सब", sabhi: "सभी", saara: "सारा", sara: "सारा", bilkul: "बिल्कुल", zaroor: "ज़रूर", shayad: "शायद", pakka: "पक्का", sach: "सच", sahi: "सही", galat: "ग़लत", mushkil: "मुश्किल", aasan: "आसान", naya: "नया", nayi: "नई", purana: "पुराना", bada: "बड़ा", chhota: "छोटा", achhi: "अच्छी", acchi: "अच्छी", achhe: "अच्छे", acche: "अच्छे", badhiya: "बढ़िया", mast: "मस्त", behtar: "बेहतर",
  baat: "बात", baatein: "बातें", yaad: "याद", yaar: "यार", dost: "दोस्त", bhai: "भाई", behen: "बहन", ghar: "घर", kaam: "काम", paisa: "पैसा", paise: "पैसे", rupaye: "रुपये", number: "नंबर", naam: "नाम", jagah: "जगह", log: "लोग", baar: "बार", waqt: "वक़्त", samay: "समय", zindagi: "ज़िंदगी", sawaal: "सवाल", jawab: "जवाब", madad: "मदद", khabar: "ख़बर", khushi: "ख़ुशी",
  kar: "कर", karo: "करो", kare: "करे", karein: "करें", kariye: "कीजिए", kijiye: "कीजिए", karna: "करना", karta: "करता", karti: "करती", karte: "करते", karke: "करके", kiya: "किया", kiye: "किए", kri: "की", karunga: "करूँगा", karungi: "करूँगी", karenge: "करेंगे", 
  hoga: "होगा", hogi: "होगी", honge: "होंगे", hona: "होना", ban: "बन", bana: "बना", banao: "बनाओ", banayein: "बनाएँ", banaye: "बनाएँ", banate: "बनाते", banega: "बनेगा", banegi: "बनेगी", banenge: "बनेंगे",
  chal: "चल", chalo: "चलो", chalna: "चलना", chalta: "चलता", chalti: "चलती", chalte: "चलते", chala: "चला", chali: "चली", chalein: "चलें", rahi: "रही", raha: "रहा", rahe: "रहे", rahega: "रहेगा", rahenge: "रहेंगे", rehna: "रहना", rehta: "रहता",
  aa: "आ", aao: "आओ", aana: "आना", aaya: "आया", aayi: "आई", aaye: "आए", aati: "आती", aata: "आता", aayega: "आएगा", aayegi: "आएगी", aaunga: "आऊँगा", aaungi: "आऊँगी", jaa: "जा", jao: "जाओ", jana: "जाना", jaana: "जाना", gaya: "गया", gayi: "गई", gaye: "गए", jaunga: "जाऊँगा", jaungi: "जाऊँगी", jayega: "जाएगा", jayenge: "जाएँगे", jaate: "जाते",
  de: "दे", dena: "देना", diya: "दिया", dijiye: "दीजिए", denge: "देंगे", le: "ले", lena: "लेना", liya: "लिया", lo: "लो", lijiye: "लीजिए", dekh: "देख", dekho: "देखो", dekhna: "देखना", dekha: "देखा", dekhte: "देखते", dekhenge: "देखेंगे",
  bol: "बोल", bolo: "बोलो", bolna: "बोलना", bola: "बोला", bata: "बता", batao: "बताओ", batana: "बताना", bataiye: "बताइए", bataya: "बताया", batayein: "बताएँ", sun: "सुन", suno: "सुनो", sunna: "सुनना", suna: "सुना", samajh: "समझ", samjha: "समझा", samjhe: "समझे", samajhna: "समझना",
  mil: "मिल", milo: "मिलो", milna: "मिलना", milte: "मिलते", milenge: "मिलेंगे", milega: "मिलेगा", mila: "मिला", milti: "मिलती", mili: "मिली", pooch: "पूछ", puch: "पूछ", poochna: "पूछना", poochta: "पूछता", poochun: "पूछूँ", pooche: "पूछे", loon: "लूँ", dun: "दूँ", doon: "दूँ", lun: "लूँ", kahun: "कहूँ", kahoon: "कहूँ",
  soch: "सोच", socha: "सोचा", sochna: "सोचना", sochte: "सोचते", chahiye: "चाहिए", chahta: "चाहता", chahti: "चाहती", chahte: "चाहते", sakta: "सकता", sakti: "सकती", sakte: "सकते", paata: "पाता", pata: "पता", maloom: "मालूम", lagta: "लगता", lagti: "लगती", laga: "लगा", lagi: "लगी", raho: "रहो", milke: "मिलके",
  shukriya: "शुक्रिया", dhanyavad: "धन्यवाद", namaste: "नमस्ते", maaf: "माफ़", maafi: "माफ़ी", swagat: "स्वागत", intezaar: "इंतज़ार", intzaar: "इंतज़ार", wapas: "वापस", zaruri: "ज़रूरी", jaruri: "ज़रूरी", aise: "ऐसे", waise: "वैसे", yahan: "यहाँ", wahan: "वहाँ", idhar: "इधर", udhar: "उधर", aisa: "ऐसा", waisa: "वैसा", aisi: "ऐसी", ghumne: "घूमने", ghoomne: "घूमने", khana: "खाना", peena: "पीना", chai: "चाय", milan: "मिलन",
  ek: "एक", do: "दो", teen: "तीन", char: "चार", paanch: "पाँच", das: "दस", sau: "सौ", hazaar: "हज़ार", lakh: "लाख", pehla: "पहला", doosra: "दूसरा", sabse: "सबसे", jyaada: "ज़्यादा", wala: "वाला", wali: "वाली", wale: "वाले",
};

/** English-looking spellings of Hindi words: turned into Devanagari only inside a sentence that is clearly Hinglish ("Is weekend" = इस वीकेंड). */
const AMBIGUOUS_ROMAN = new Set(["is", "to", "me", "ho", "the", "do", "hi", "he", "ye", "main", "mat", "par", "pe", "ab", "kar", "bas", "aa", "ban", "de", "le", "lo", "us", "in", "so", "na", "tu", "pata", "den", "sun", "dun", "lun", "mil", "chal", "tak", "bar", "din", "das", "sab", "sara", "tab", "jab", "kam", "dekh", "bol", "soch", "ka", "ki", "ke"]);
const EXTRA_AMBIGUOUS: Record<string, string> = { is: "इस", us: "उस", he: "हे" };
// Counted as evidence of Hinglish: Hindi words that are not also ordinary English words.
const isMarker = (w: string) => w in ROMAN_HINDI && !AMBIGUOUS_ROMAN.has(w);

const LETTERS: Record<string, string> = {
  a: "ए", b: "बी", c: "सी", d: "डी", e: "ई", f: "एफ़", g: "जी", h: "एच", i: "आई", j: "जे", k: "के", l: "एल", m: "एम", n: "एन", o: "ओ", p: "पी",
  q: "क्यू", r: "आर", s: "एस", t: "टी", u: "यू", v: "वी", w: "डब्ल्यू", x: "एक्स", y: "वाई", z: "ज़ेड",
};

/** Letters read out one by one, the way Indian speakers say an abbreviation: AI becomes "ए आई". */
const spell = (w: string) => [...w.toLowerCase()].map((c) => LETTERS[c] ?? c).join(" ");

export const hasDevanagari = (t: string) => /[ऀ-ॿ]/.test(t);

/** Hindi words found in a stretch of English-letter text; two or more means it is Hinglish. */
const markers = (t: string) => (t.toLowerCase().match(/[a-z]+/g) ?? []).filter(isMarker).length;

/**
 * Hinglish typed in English letters becomes Devanagari for the Hindi words, so the Hindi voice reads them properly. A sentence counts
 * when it has two Hindi words, or one Hindi word in a script whose other sentences are Hinglish. Pure English sentences stay as they are.
 */
export function romanHinglishToDevanagari(text: string): string {
  const scriptIsHinglish = markers(text) >= 2;
  return text.replace(/[^.!?\n]+[.!?\n]*/g, (sentence) => {
    const m = markers(sentence);
    if (m < 2 && !(m === 1 && scriptIsHinglish)) return sentence;
    return sentence.replace(/[A-Za-z]+/g, (w, at: number) => {
      const k = w.toLowerCase();
      if (k === "to") { const before = /([A-Za-z]+)\W*$/.exec(sentence.slice(0, at))?.[1]?.toLowerCase(); return before && !(before in ROMAN_HINDI) ? "टू" : "तो"; } // "need to" is English, "aaj to" is Hindi
      if (k === "hi" && w !== k) return w; // "Hi" with a capital is a greeting
      if (k === "the") return w;
      return ROMAN_HINDI[k] ?? EXTRA_AMBIGUOUS[k] ?? w;
    });
  });
}

export function hinglishToDevanagari(text: string): string {
  text = romanHinglishToDevanagari(text);
  if (!hasDevanagari(text)) return text;
  return text.replace(/[A-Za-z]+(?:['’][A-Za-z]+)?/g, (word) => {
    const known = WORDS[word.toLowerCase()];
    if (known) return known;
    if (word.length >= 2 && word.length <= 5 && word === word.toUpperCase() && /^[A-Z]+$/.test(word)) return spell(word); // OTP, CRM, SMS, AI
    return word; // not listed: left as it is
  });
}
