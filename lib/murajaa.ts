import { juzOf, juzRange, pagesBefore } from "./scoring";
import type { DayLog, Prefs } from "./types";

/** Where each juz starts and ends (Madinah Mushaf). */
export const JUZ_SURAHS: [string, string][] = [
  ["Al-Fātiḥah", "Al-Baqarah"], ["Al-Baqarah", "Al-Baqarah"], ["Al-Baqarah", "Āl ʿImrān"], ["Āl ʿImrān", "An-Nisāʾ"], ["An-Nisāʾ", "An-Nisāʾ"],
  ["An-Nisāʾ", "Al-Māʾidah"], ["Al-Māʾidah", "Al-Anʿām"], ["Al-Anʿām", "Al-Aʿrāf"], ["Al-Aʿrāf", "Al-Anfāl"], ["Al-Anfāl", "At-Tawbah"],
  ["At-Tawbah", "Hūd"], ["Hūd", "Yūsuf"], ["Yūsuf", "Ibrāhīm"], ["Al-Ḥijr", "An-Naḥl"], ["Al-Isrāʾ", "Al-Kahf"],
  ["Al-Kahf", "Ṭā-Hā"], ["Al-Anbiyāʾ", "Al-Ḥajj"], ["Al-Muʾminūn", "Al-Furqān"], ["Al-Furqān", "An-Naml"], ["An-Naml", "Al-ʿAnkabūt"],
  ["Al-ʿAnkabūt", "Al-Aḥzāb"], ["Al-Aḥzāb", "Yā-Sīn"], ["Yā-Sīn", "Az-Zumar"], ["Az-Zumar", "Fuṣṣilat"], ["Fuṣṣilat", "Al-Jāthiyah"],
  ["Al-Aḥqāf", "Adh-Dhāriyāt"], ["Adh-Dhāriyāt", "Al-Ḥadīd"], ["Al-Mujādilah", "At-Taḥrīm"], ["Al-Mulk", "Al-Mursalāt"], ["An-Nabaʾ", "An-Nās"],
];

/**
 * Murājaʿa is one juz a day, in order, over the pages you have memorised. After the last (partly)
 * memorised juz it starts again at juz 1. The last juz only covers the pages memorised before that day.
 */
export function murajaaPlan(days: Record<string, DayLog>, prefs: Prefs, date: string) {
  const memorised = pagesBefore(days, prefs, date); // pages memorised before this day
  const lastJuz = memorised > 0 ? juzOf(memorised) : 0;
  const todays = days[date]?.quran.revJuz;
  let prev = 0;
  for (const k of Object.keys(days).sort().reverse()) {
    if (k >= date) continue;
    const j = days[k].quran.revJuz;
    if (j) { prev = j; break; }
  }
  const suggested = !lastJuz ? 0 : prev >= lastJuz || prev < 1 ? 1 : prev + 1;
  const juz = todays || suggested;
  return { memorised, lastJuz, juz, suggested, range: juz ? rangeOf(juz, memorised) : null };
}

/** The pages of a juz you have memorised (the whole juz, or the part of the last one). */
export function rangeOf(juz: number, memorised: number) {
  const [a, b] = juzRange(juz);
  const to = Math.min(b, memorised);
  return { from: a, to: Math.max(a, to), partial: to < b, surahs: JUZ_SURAHS[juz - 1] };
}
