import type { DayLog } from "./types";

/** Voluntary acts: they only ever add, and are kept apart from the /100 score. */
export interface BonusLog {
  tahajjud: boolean;
  witr: boolean;
  duha: boolean;
  adhkarAm: boolean;
  adhkarPm: boolean;
  fast: boolean;
  rawatib: Record<RawatibId, boolean>;
}

export type RawatibId = "fajr" | "dhuhrBefore" | "dhuhrAfter" | "maghrib" | "isha";

/** The 12 sunnah rawātib (Umm Ḥabībah's hadith): 2 before Fajr, 4 before Dhuhr, 2 after, 2 after Maghrib, 2 after Isha. */
export const RAWATIB: { id: RawatibId; label: string; rakat: number }[] = [
  { id: "fajr", label: "2 before Subh", rakat: 2 },
  { id: "dhuhrBefore", label: "4 before Dhuhr", rakat: 4 },
  { id: "dhuhrAfter", label: "2 after Dhuhr", rakat: 2 },
  { id: "maghrib", label: "2 after Maghrib", rakat: 2 },
  { id: "isha", label: "2 after Isha", rakat: 2 },
];

export const BONUS_ITEMS: { id: Exclude<keyof BonusLog, "rawatib">; label: string; sub: string; pts: number; ar: string }[] = [
  { id: "tahajjud", label: "Tahajjud", sub: "Night prayer before Subh", pts: 5, ar: "التهجد" },
  { id: "witr", label: "Witr", sub: "", pts: 5, ar: "الوتر" },
  { id: "duha", label: "Ḍuḥā", sub: "Forenoon prayer", pts: 5, ar: "الضحى" },
  { id: "adhkarAm", label: "Morning adhkār", sub: "", pts: 2.5, ar: "أذكار الصباح" },
  { id: "adhkarPm", label: "Evening adhkār", sub: "", pts: 2.5, ar: "أذكار المساء" },
  { id: "fast", label: "Voluntary fast", sub: "Monday, Thursday, white days…", pts: 5, ar: "صيام" },
];

export const RAWATIB_PTS = 5;
export const BONUS_MAX = BONUS_ITEMS.reduce((n, b) => n + b.pts, 0) + RAWATIB_PTS;

export function blankBonus(): BonusLog {
  return { tahajjud: false, witr: false, duha: false, adhkarAm: false, adhkarPm: false, fast: false,
    rawatib: { fajr: false, dhuhrBefore: false, dhuhrAfter: false, maghrib: false, isha: false } };
}

export function normalizeBonus(b?: Partial<BonusLog> | null): BonusLog {
  const z = blankBonus();
  return { ...z, ...(b ?? {}), rawatib: { ...z.rawatib, ...(b?.rawatib ?? {}) } };
}

export const rakatDone = (b: BonusLog) => RAWATIB.reduce((n, r) => n + (b.rawatib[r.id] ? r.rakat : 0), 0);

export function bonusPoints(d: DayLog) {
  const b = d.bonus;
  return BONUS_ITEMS.reduce((n, it) => n + (b[it.id] ? it.pts : 0), 0) + (rakatDone(b) / 12) * RAWATIB_PTS;
}

/** Plain-English list for the sheet, e.g. "Tahajjud, Witr, Rawātib 8/12". */
export function bonusList(d: DayLog) {
  const out = BONUS_ITEMS.filter((it) => d.bonus[it.id]).map((it) => it.label);
  const r = rakatDone(d.bonus);
  if (r) out.push(`Rawātib ${r}/12`);
  return out.join(", ");
}
