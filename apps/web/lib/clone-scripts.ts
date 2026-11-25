/**
 * Reading scripts for voice cloning. Each takes about 45 to 60 seconds at a normal pace, so the recording is over the 30
 * seconds a clone needs to sound full. They cover greetings, numbers, prices, questions, apologies and goodbyes, because
 * those are what the AI says on calls.
 */
export const ENGLISH_SCRIPT =
  "Hello, and thank you for calling Bizfy. My name is on the screen, and I would be happy to help you today. " +
  "Our plans start at four thousand nine hundred ninety nine rupees per month, and you can change or cancel at any time. " +
  "The Starter plan is one thousand nine hundred ninety nine rupees, and it includes up to three users. " +
  "If you would like, I can send you the details on your phone or email. Could you please tell me your name and the best number to reach you? " +
  "I am sorry, I did not catch that. Could you say it once more, a little slower? " +
  "Thank you for waiting. I have noted everything down, and a colleague will call you back tomorrow between ten in the morning and six in the evening. " +
  "Is there anything else I can help you with today? " +
  "Thank you so much for your time. Have a wonderful day, and goodbye.";

export const HINDI_SCRIPT =
  "नमस्ते, और बिज़्फी में कॉल करने के लिए आपका धन्यवाद। मेरा नाम स्क्रीन पर दिख रहा है, और मुझे आज आपकी मदद करके बहुत खुशी होगी। " +
  "हमारी योजनाएँ चार हज़ार नौ सौ निन्यानवे रुपये प्रति माह से शुरू होती हैं, और आप इन्हें कभी भी बदल या रद्द कर सकते हैं। " +
  "स्टार्टर प्लान एक हज़ार नौ सौ निन्यानवे रुपये का है, और उसमें तीन उपयोगकर्ता शामिल हैं। " +
  "अगर आप चाहें, तो मैं पूरी जानकारी आपके फ़ोन या ईमेल पर भेज सकती हूँ। कृपया अपना नाम और संपर्क करने का सबसे अच्छा नंबर बताइए। " +
  "माफ़ कीजिए, मैं ठीक से समझ नहीं पाई। क्या आप इसे एक बार फिर, थोड़ा धीरे से कह सकते हैं? " +
  "प्रतीक्षा करने के लिए धन्यवाद। मैंने सब कुछ लिख लिया है, और हमारे सहयोगी कल सुबह दस बजे से शाम छह बजे के बीच आपको वापस कॉल करेंगे। " +
  "क्या आज मैं आपकी और कोई मदद कर सकती हूँ? " +
  "आपके समय के लिए बहुत-बहुत धन्यवाद। आपका दिन शुभ हो, नमस्कार।";

export const HINGLISH_SCRIPT =
  "Hello, and thank you for calling Bizfy. Mera naam screen par dikh raha hai, aur aapki help karke mujhe bahut khushi hogi. " +
  "Hamare plans 4,999 rupees per month se start hote hain, aur aap kabhi bhi change ya cancel kar sakte hain. " +
  "Starter plan 1,999 rupees ka hai, aur usme up to 3 users include hain. " +
  "Agar aap chahein, toh saari details aapke phone ya email par send ho jayengi. Please apna name aur best number bataiye. " +
  "Sorry, mujhe yeh clear nahi hua. Kya aap ek baar phir, thoda slow bol sakte hain? " +
  "Wait karne ke liye thank you. Maine sab kuch note kar liya hai, aur hamare colleague kal subah 10 baje se shaam 6 baje ke beech aapko call back karenge. " +
  "Kya aaj aapko kisi aur cheez mein help chahiye? " +
  "Aapke time ke liye bahut bahut thank you. Have a wonderful day, goodbye.";

/** Roughly how long the script takes to read, so the wizard can say so. */
export const SCRIPT_SECONDS = { en: 55, hi: 60, hinglish: 60 } as const;
export const MIN_CLONE_SECONDS = 30;
