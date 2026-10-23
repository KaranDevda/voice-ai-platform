export type Gender = "female" | "male";
export interface StockVoice { id: string; name: string; gender: Gender; accent: string; trait: string; lang: string }

const v = (name: string, gender: Gender, accent: string, trait: string, lang = "en"): StockVoice => ({
  id: `aura-2-${name.toLowerCase()}-${lang}`, name, gender, accent, trait, lang,
});

/** Deepgram Aura-2 voices (https://developers.deepgram.com/docs/tts-models). No Hindi voices exist in this catalogue. */
export const STOCK_VOICES: StockVoice[] = [
  v("Thalia", "female", "US", "Clear and energetic"), v("Asteria", "female", "US", "Clear and knowledgeable"),
  v("Andromeda", "female", "US", "Casual and expressive"), v("Athena", "female", "US", "Calm and professional"),
  v("Aurora", "female", "US", "Cheerful and expressive"), v("Callista", "female", "US", "Clear and professional"),
  v("Cora", "female", "US", "Smooth and melodic"), v("Cordelia", "female", "US", "Approachable and polite"),
  v("Delia", "female", "US", "Casual and breathy"), v("Electra", "female", "US", "Professional and engaging"),
  v("Harmonia", "female", "US", "Empathetic and calm"), v("Helena", "female", "US", "Caring and raspy"),
  v("Hera", "female", "US", "Smooth and warm"), v("Iris", "female", "US", "Cheerful and positive"),
  v("Juno", "female", "US", "Natural and breathy"), v("Luna", "female", "US", "Friendly and natural"),
  v("Minerva", "female", "US", "Positive and natural"), v("Ophelia", "female", "US", "Expressive and enthusiastic"),
  v("Phoebe", "female", "US", "Energetic and warm"), v("Selene", "female", "US", "Expressive and engaging"),
  v("Vesta", "female", "US", "Natural and empathetic"), v("Janus", "female", "US South", "Southern and trustworthy"),
  v("Amalthea", "female", "Filipino", "Engaging and cheerful"), v("Pandora", "female", "British", "Smooth and melodic"),
  v("Theia", "female", "Australian", "Expressive and polite"),
  v("Apollo", "male", "US", "Confident and casual"), v("Arcas", "male", "US", "Natural and smooth"),
  v("Aries", "male", "US", "Warm and energetic"), v("Atlas", "male", "US", "Enthusiastic and friendly"),
  v("Hermes", "male", "US", "Expressive and professional"), v("Jupiter", "male", "US", "Expressive and knowledgeable"),
  v("Mars", "male", "US", "Smooth and patient"), v("Neptune", "male", "US", "Professional and patient"),
  v("Odysseus", "male", "US", "Calm and professional"), v("Orion", "male", "US", "Approachable and calm"),
  v("Orpheus", "male", "US", "Professional and trustworthy"), v("Pluto", "male", "US", "Smooth and empathetic"),
  v("Saturn", "male", "US", "Knowledgeable and confident"), v("Zeus", "male", "US", "Deep and trustworthy"),
  v("Draco", "male", "British", "Warm and trustworthy"), v("Hyperion", "male", "Australian", "Caring and empathetic"),
];

export const DEFAULT_STOCK_VOICE = "aura-2-thalia-en";
export const stockVoiceById = (id: string) => STOCK_VOICES.find((s) => s.id === id);
