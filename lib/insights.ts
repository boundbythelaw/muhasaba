import { PRAYERS, REASONS } from "./constants";
import { addDays, parseKey } from "./dates";
import { checkinDone, excused, scoreDay, sleepHours } from "./scoring";
import type { DayLog } from "./types";

/** A day counts once something was logged in it. */
export const isUsed = (d?: DayLog) =>
  !!d && (Object.keys(d.prayers).length > 0 || d.quran.mem > 0 || d.work.hours > 0 || !!d.steps || d.journal.length > 0 || checkinDone(d.checkin));

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
export const BAD = 60;

export interface Bucket { label: string; avg: number | null; n: number }

function bucket<T>(rows: T[], groups: { label: string; test: (r: T) => boolean }[], val: (r: T) => number): Bucket[] {
  return groups.map((g) => { const xs = rows.filter(g.test).map(val); return { label: g.label, avg: avg(xs), n: xs.length }; });
}

/** Everything the in-app Insights card shows. The sheet's Insights tab goes further. */
export function computeInsights(days: Record<string, DayLog>) {
  const keys = Object.keys(days).filter((k) => isUsed(days[k])).sort();
  const rows = keys.map((k) => {
    const d = days[k];
    return { k, d, s: scoreDay(d), wd: parseKey(k).getDay() };
  });
  const score = new Map(rows.map((r) => [r.k, r.s.total]));

  const weekday = [1, 2, 3, 4, 5, 6, 0].map((w) => {
    const xs = rows.filter((r) => r.wd === w).map((r) => r.s.total);
    return { wd: w, avg: avg(xs), n: xs.length };
  });
  const ranked = weekday.filter((w) => w.n > 0 && w.avg != null).sort((a, b) => b.avg! - a.avg!);

  const sorted = [...rows].sort((a, b) => b.s.total - a.s.total);
  const best = sorted.slice(0, 3), worst = sorted.slice(-3).reverse();

  // Rebound: what the day after a bad day looks like.
  const after = rows.filter((r) => r.s.total < BAD && score.has(addDays(r.k, 1))).map((r) => ({ bad: r.s.total, next: score.get(addDays(r.k, 1))! }));
  const rebound = {
    n: after.length,
    nextAvg: avg(after.map((x) => x.next)),
    better: after.filter((x) => x.next > x.bad + 5).length,
    worse: after.filter((x) => x.next < x.bad - 5).length,
  };

  const prayers = PRAYERS.map(({ id, en }) => {
    const marked = rows.filter((r) => r.d.prayers[id] != null || r.d.why[id]);
    const top = marked.filter((r) => r.d.prayers[id] === 2).length;
    const mosque = marked.filter((r) => (r.d.prayers[id] ?? -1) >= 1).length;
    const exc = marked.filter((r) => excused(r.d.why[id])).length;
    const base = marked.length - exc;
    return { id, en, n: marked.length, takbir: base ? top / base : null, mosque: base ? mosque / base : null };
  });
  const hardest = prayers.filter((p) => p.takbir != null && p.n >= 3).sort((a, b) => a.takbir! - b.takbir!)[0] ?? null;

  const reasons = REASONS.map((r) => ({ ...r, n: rows.reduce((n, x) => n + PRAYERS.filter(({ id }) => x.d.why[id]?.r === r.id).length, 0) }))
    .filter((r) => r.n > 0).sort((a, b) => b.n - a.n);

  const hifz = rows.filter((r) => r.d.quran.mem > 0 && r.d.quran.minutes);
  const perPage = avg(hifz.map((r) => r.d.quran.minutes! / r.d.quran.mem));
  const byDiff = (["easy", "normal", "hard"] as const).map((df) => ({ diff: df, avg: avg(hifz.filter((r) => r.d.quran.diff === df).map((r) => r.d.quran.minutes! / r.d.quran.mem)) }));

  const ck = rows.filter((r) => checkinDone(r.d.checkin));
  const sleep = bucket(ck, [
    { label: "< 6 h", test: (r) => (sleepHours(r.d.checkin) ?? 0) < 6 },
    { label: "6–7 h", test: (r) => { const h = sleepHours(r.d.checkin) ?? 0; return h >= 6 && h < 7; } },
    { label: "7–8 h", test: (r) => { const h = sleepHours(r.d.checkin) ?? 0; return h >= 7 && h < 8; } },
    { label: "8 h +", test: (r) => (sleepHours(r.d.checkin) ?? 0) >= 8 },
  ], (r) => r.s.total);
  const bedMin = (t: string) => { const [h, m] = t.split(":").map(Number); return ((h + 12) % 24) * 60 + m; }; // minutes after noon
  const bedtime = bucket(ck, [
    { label: "before 23:00", test: (r) => bedMin(r.d.checkin.slept!) < 11 * 60 },
    { label: "23:00–00:00", test: (r) => { const m = bedMin(r.d.checkin.slept!); return m >= 11 * 60 && m < 12 * 60; } },
    { label: "00:00–01:00", test: (r) => { const m = bedMin(r.d.checkin.slept!); return m >= 12 * 60 && m < 13 * 60; } },
    { label: "after 01:00", test: (r) => bedMin(r.d.checkin.slept!) >= 13 * 60 },
  ], (r) => r.s.total);
  const phone = bucket(ck, [
    { label: "None", test: (r) => r.d.checkin.phone === 0 },
    { label: "A bit", test: (r) => r.d.checkin.phone === 1 },
    { label: "A lot", test: (r) => r.d.checkin.phone === 2 },
  ], (r) => r.s.total);
  const slips = ck.filter((r) => r.d.checkin.slip);
  const clean = ck.filter((r) => !r.d.checkin.slip);
  const slip = {
    n: slips.length,
    sleepSlip: avg(slips.map((r) => sleepHours(r.d.checkin) ?? 0)),
    sleepClean: avg(clean.map((r) => sleepHours(r.d.checkin) ?? 0)),
    phoneLotSlip: slips.length ? slips.filter((r) => r.d.checkin.phone === 2).length / slips.length : null,
    phoneLotClean: clean.length ? clean.filter((r) => r.d.checkin.phone === 2).length / clean.length : null,
    tawbah: slips.filter((r) => r.d.checkin.tawbah).length,
  };

  return { n: rows.length, avg: avg(rows.map((r) => r.s.total)), weekday, bestWd: ranked[0] ?? null, worstWd: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    best, worst, rebound, prayers, hardest, reasons, perPage, byDiff, checkins: ck.length, sleep, bedtime, phone, slip };
}
