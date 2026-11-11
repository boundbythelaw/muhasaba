import { MAX, MUSHAF_PAGES, PRAYERS, reasonOf, STEP_GOAL } from "./constants";
import { tr } from "./i18n";
import { blankBonus, bonusPoints, normalizeBonus } from "./bonus";
import type { Checkin, DayLog, PrayerWhy, Prefs, RevRange, Scores } from "./types";
import type { PrayerId } from "./constants";

export function blankCheckin(): Checkin {
  return { slept: null, woke: null, phone: null, energy: null, mood: null, slip: false, tawbah: false };
}

/** The check-in counts as done once sleep, phone, energy and mood are filled in. */
export const checkinDone = (c: Checkin) => !!(c.slept && c.woke && c.phone != null && c.energy && c.mood);

/** Hours slept from "HH:MM" to "HH:MM" (crossing midnight). */
export function sleepHours(c: Pick<Checkin, "slept" | "woke">) {
  if (!c.slept || !c.woke) return null;
  const m = (t: string) => { const [h, mi] = t.split(":").map(Number); return h * 60 + mi; };
  let d = m(c.woke) - m(c.slept);
  if (d <= 0) d += 1440;
  return Math.round((d / 60) * 10) / 10;
}

/** True when this prayer was excused and prayed properly: it scores the full 8. */
export function excused(w?: PrayerWhy) {
  const r = reasonOf(w?.r);
  return !!(r && r.excuse && (w!.r === "period" || w!.ok));
}

export const revPages = (rev: RevRange[]) => rev.reduce((n, r) => n + Math.max(0, r.to - r.from + 1), 0);

export function blankDay(): DayLog {
  return {
    prayers: {},
    why: {},
    checkin: blankCheckin(),
    rev: [],
    quran: { mem: 0, minutes: null, diff: null, preview: false, juz: false, mulkSubh: false, mulkMaghrib: false },
    work: { hours: 0, topics: [], note: "" },
    steps: null,
    shukr: "",
    journal: [],
    bonus: blankBonus(),
  };
}

/** Fill any missing fields so older or partial records are always safe to read. */
export function normalizeDay(d?: Partial<DayLog> | null): DayLog {
  const b = blankDay();
  if (!d) return b;
  return {
    prayers: { ...(d.prayers ?? {}) },
    why: Object.fromEntries(Object.entries(d.why ?? {}).filter(([, w]) => w && reasonOf(w.r)).map(([k, w]) => [k, { ...w }])) as Partial<Record<PrayerId, PrayerWhy>>,
    checkin: { ...blankCheckin(), ...(d.checkin ?? {}) },
    rev: Array.isArray(d.rev) ? d.rev.filter((r) => r && r.from > 0 && r.to >= r.from).map((r) => ({ from: r.from, to: r.to })) : [],
    quran: { ...b.quran, ...(d.quran ?? {}) },
    work: { ...b.work, ...(d.work ?? {}), topics: [...(d.work?.topics ?? [])] },
    steps: d.steps ?? null,
    shukr: d.shukr ?? "",
    journal: Array.isArray(d.journal)
      ? d.journal.filter((e) => e && typeof e.text === "string").map((e) => ({ ...e, ...(e.photos?.length ? { photos: e.photos.filter((p) => p && p.id).map((p) => ({ ...p })) } : { photos: undefined }) }))
      : [],
    bonus: normalizeBonus(d.bonus),
    unlocks: Array.isArray(d.unlocks) ? d.unlocks.map((u) => ({ ...u })) : [],
  };
}

const PRAYER_POINTS = [0, 4, 8] as const;

export function workPoints(hours: number) {
  const h = Math.max(0, hours || 0);
  if (h >= 3) return 20;
  if (h >= 2) return 14 + (h - 2) * 6;
  if (h >= 1) return 8 + (h - 1) * 6;
  return h * 8;
}

export function scoreDay(d: DayLog): Scores {
  const p = PRAYERS.reduce((sum, { id }) => {
    if (excused(d.why[id])) return sum + 8;
    const v = d.prayers[id];
    return sum + (v == null ? 0 : PRAYER_POINTS[v]);
  }, 0);
  const q = d.quran;
  const qs =
    (q.mem >= 2 ? 15 : q.mem === 1 ? 7 : 0) +
    (q.preview ? 5 : 0) +
    (q.juz ? 5 : 0) +
    (q.mulkSubh ? 2.5 : 0) +
    (q.mulkMaghrib ? 2.5 : 0);
  const w = workPoints(d.work.hours);
  const s = d.steps ? Math.min(d.steps / STEP_GOAL, 1) * 10 : 0;
  return { p, q: qs, w, s, total: p + qs + w + s, bonus: bonusPoints(d) };
}

export const ZERO: Scores = { p: 0, q: 0, w: 0, s: 0, total: 0, bonus: 0 };

export const isMax = (k: keyof typeof MAX, v: number) => v >= MAX[k] - 0.01;

export const grade = (t: number) =>
  tr(t >= 99.95 ? "Perfect day" : t >= 90 ? "Excellent day" : t >= 75 ? "Strong day" : t >= 50 ? "Steady day" : t > 0 ? "Keep building" : "A fresh page");

export const fmt = (n: number) => Math.round(n * 10) / 10;

/* ---------- Qur'an ---------- */

export function pagesBefore(days: Record<string, DayLog>, prefs: Prefs, k: string) {
  let n = Number(prefs.basePage) || 0;
  for (const key in days) {
    if (key >= prefs.baseDate && key < k) n += Number(days[key].quran?.mem) || 0;
  }
  return Math.min(n, MUSHAF_PAGES);
}

export function portion(days: Record<string, DayLog>, prefs: Prefs, k: string) {
  const done = pagesBefore(days, prefs, k);
  const from = Math.min(done + 1, MUSHAF_PAGES);
  const to = Math.min(done + 2, MUSHAF_PAGES);
  return { done, from, to, previewFrom: Math.min(to + 1, MUSHAF_PAGES), previewTo: Math.min(to + 2, MUSHAF_PAGES) };
}

/** Standard Madinah mushaf: juz 1 = pages 1–21, then 20 pages per juz, juz 30 ends on 604. */
export const juzRange = (j: number): [number, number] => [j === 1 ? 1 : 2 + (j - 1) * 20, j === 30 ? MUSHAF_PAGES : 21 + (j - 1) * 20];
export const juzOf = (page: number) => Math.min(30, Math.max(1, Math.floor((page - 2) / 20) + 1));
export function juzFill(j: number, done: number) {
  const [a, b] = juzRange(j);
  return Math.max(0, Math.min(1, (done - a + 1) / (b - a + 1)));
}
