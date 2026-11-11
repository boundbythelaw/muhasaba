import { MUSHAF_PAGES } from "./constants";
import { addDays } from "./dates";
import { pagesBefore } from "./scoring";
import type { DayLog, Prefs, RevRange } from "./types";

export const STALE_DAYS = 30;

/**
 * When each memorised page was last revised (or memorised), as of `date`.
 * Pages memorised before the app was used have no date until you revise them in the app.
 */
export function revisionMap(days: Record<string, DayLog>, prefs: Prefs, date: string) {
  const memorised = pagesBefore(days, prefs, addDays(date, 1));
  const last: (string | null)[] = new Array(memorised + 1).fill(null);
  const keys = Object.keys(days).filter((k) => k <= date).sort();
  let done = Number(prefs.basePage) || 0;
  for (const k of keys) {
    const d = days[k];
    if (k >= prefs.baseDate) {
      const mem = Number(d.quran?.mem) || 0;
      for (let p = done + 1; p <= Math.min(done + mem, memorised); p++) last[p] = k;
      done += mem;
    }
    for (const r of d.rev ?? []) for (let p = Math.max(1, r.from); p <= Math.min(r.to, memorised); p++) last[p] = k;
  }
  return { memorised, last };
}

export function revisionStatus(days: Record<string, DayLog>, prefs: Prefs, date: string) {
  const { memorised, last } = revisionMap(days, prefs, date);
  const cutoff = addDays(date, -STALE_DAYS);
  const stale: number[] = [];
  for (let p = 1; p <= memorised; p++) if (!last[p] || last[p]! < cutoff) stale.push(p);
  // Suggest the stalest block: never-revised first, then the oldest date, up to 20 pages in a row.
  let next: RevRange | null = null;
  if (stale.length) {
    const rank = (p: number) => last[p] ?? "";
    const start = [...stale].sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : a - b))[0];
    let to = start;
    const set = new Set(stale);
    while (to + 1 <= memorised && set.has(to + 1) && to - start < 19) to++;
    next = { from: start, to };
  }
  return { memorised, stale: stale.length, fresh: memorised - stale.length, next };
}

export function clampRange(from: number, to: number): RevRange | null {
  const a = Math.max(1, Math.min(MUSHAF_PAGES, Math.round(from)));
  const b = Math.max(1, Math.min(MUSHAF_PAGES, Math.round(to)));
  if (!a || !b) return null;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}
