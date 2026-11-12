export const PROFILE = {
  name: "Mohamed",
  fullName: "Mohamed Diallo",
  birth: { year: 2006, month: 5, day: 18 },
} as const;

export const PRAYERS = [
  { id: "subh", en: "Subh", ar: "الصبح" },
  { id: "dhuhr", en: "Dhuhr", ar: "الظهر" },
  { id: "asr", en: "Asr", ar: "العصر" },
  { id: "maghrib", en: "Maghrib", ar: "المغرب" },
  { id: "isha", en: "Isha", ar: "العشاء" },
] as const;

export type PrayerId = (typeof PRAYERS)[number]["id"];

export const TOPICS = [
  "Cold emailing",
  "LinkedIn",
  "Website",
  "Outreach",
  "Content",
  "Sales calls",
  "Planning",
] as const;

export const MUSHAF_PAGES = 604;
export const STEP_GOAL = 8000;
export const STEP_SLIDER_MAX = 20000;

export const MAX = { p: 40, q: 30, w: 20, s: 10 } as const;
export type Pillar = keyof typeof MAX;
export const PILLAR_NAME: Record<Pillar, string> = { p: "Salah", q: "Qur'an", w: "Work", s: "Walk" };

/** 127 pages memorised before 5 Nov 2026, so that day's portion is pages 128–129. */
export const DEFAULT_PREFS: import("./types").Prefs = {
  basePage: 0,
  baseDate: "2026-11-05",
  lang: "fr",
  name: "",
  birth: "",
  welcomed: false,
  prayerLoc: { id: "conakry", label: "Conakry", lat: 9.6412, lng: -13.5784, tz: "Africa/Conakry", method: "auto" },
  asr: "standard",
  gender: "",
};
/** Settings for the original install (Mohamed), applied when an existing install has no profile yet. */
export const MOHAMED_PREFS = { basePage: 127, lang: "en" as const, name: "Mohamed", birth: "2006-05-18", welcomed: true, gender: "m" as const };

/** Reasons for being late or missing the mosque. Excuses keep the full 8 points when the prayer was prayed properly. */
export const REASONS: { id: import("./types").PrayerReason; label: string; excuse: boolean; women?: boolean; okLabel?: string }[] = [
  { id: "travel", label: "Travelling", excuse: true, okLabel: "Prayed it as the Sunnah allows (shortened / combined, on time)" },
  { id: "ill", label: "Ill", excuse: true, okLabel: "Prayed it as I was able, on time" },
  { id: "period", label: "Menstruation", excuse: true, women: true },
  { id: "weather", label: "Rain / danger", excuse: true, okLabel: "Prayed it on time where I was" },
  { id: "slept", label: "Overslept", excuse: false },
  { id: "phone", label: "Phone / scrolling", excuse: false },
  { id: "work", label: "Work", excuse: false },
  { id: "lazy", label: "Laziness", excuse: false },
  { id: "outage", label: "Power outage", excuse: false },
  { id: "other", label: "Other", excuse: false },
];
export const reasonOf = (id?: string) => REASONS.find((r) => r.id === id);

/** Bonus: murājaʿa, 1 point per 4 pages revised, up to 5 (one juz). */
export const REV_PTS_PER_PAGE = 0.25;
export const REV_PTS_MAX = 0; // murājaʿa now scores inside the Qur'an card (the juz, +5)

export const STORAGE_KEY = "muhasaba-v1";
export const THEME_KEY = "muhasaba-theme";
