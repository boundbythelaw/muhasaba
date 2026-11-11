import { PRAYERS, reasonOf } from "./constants";
import { hijri, parseKey } from "./dates";
import { checkinDone, excused, fmt, portion, revPages, scoreDay, sleepHours } from "./scoring";
import { bonusList } from "./bonus";
import type { DayLog, Prefs } from "./types";

export interface SheetState {
  url: string;
  /** date → version stamp of the latest unsent change */
  pending: Record<string, number>;
  lastSync: number | null;
  sheetName?: string;
  /** Column layout version last seen from the script; a change makes the app send every day again. */
  schema?: number;
}

export const EMPTY_SHEET: SheetState = { url: "", pending: {}, lastSync: null };

export type SyncStatus = "off" | "idle" | "waiting" | "syncing" | "ok" | "offline" | "error";

const PRAYER_LABEL = ["No mosque", "Mosque (late)", "Before takbīr"] as const;
const DIFF_LABEL = { easy: "Easy", normal: "Normal", hard: "Hard" } as const;

export function isScriptUrl(u: string) {
  return /^https:\/\/script\.google\.com\/(a\/macros\/[^/]+|macros)\/s\/[\w-]+\/exec\/?$/.test(u.trim());
}

/** One flat row for the sheet. Column order is decided by the Apps Script. */
export function buildRow(date: string, days: Record<string, DayLog>, prefs: Prefs) {
  const d = days[date];
  const s = scoreDay(d);
  const po = portion(days, prefs, date);
  const row: Record<string, string | number | boolean | null | { t: string; text: string; photos?: (string | { v: string; p: string; d: number })[] }[]> = {
    date,
    longDate: parseKey(date).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    hijri: hijri(date),
    // Photos are only sent once their copy is in Drive (the script inserts them into the Doc by Drive id).
    journal: d.journal
      .map((e) => ({
        t: e.t, text: e.text.trim(),
        // A photo is its Drive id; a finished video is { v: video, p: cover picture, d: seconds }.
        photos: (e.photos ?? []).flatMap((p): (string | { v: string; p: string; d: number })[] =>
          p.kind === "video" ? (p.drive && p.poster ? [{ v: p.drive, p: p.poster, d: Math.round(p.dur ?? 0) }] : []) : p.drive ? [p.drive] : []),
      }))
      .filter((e) => e.text || e.photos.length)
      .map((e) => (e.photos.length ? e : { t: e.t, text: e.text })),
    day: parseKey(date).toLocaleDateString("en-GB", { weekday: "short" }),
    score: fmt(s.total),
    salah: fmt(s.p),
    quran: fmt(s.q),
    work: fmt(s.w),
    walk: fmt(s.s),
    bonus: fmt(s.bonus),
    bonusList: bonusList(d),
    pages: d.quran.mem,
    portion: `${po.from}–${po.to}`,
    minutes: d.quran.minutes,
    difficulty: d.quran.diff ? DIFF_LABEL[d.quran.diff] : null,
    preview: d.quran.preview,
    juz: d.quran.juz,
    mulkSubh: d.quran.mulkSubh,
    mulkMaghrib: d.quran.mulkMaghrib,
    hours: d.work.hours || 0,
    topics: d.work.topics.join(", "),
    note: d.work.note,
    steps: d.steps,
    shukr: d.shukr,
  };
  for (const { id } of PRAYERS) {
    const v = d.prayers[id];
    row[id] = excused(d.why[id]) ? "Excused" : v == null ? null : PRAYER_LABEL[v];
  }
  // "Subh: Overslept · Asr: Travelling ✓" (✓ = excuse prayed properly)
  row.reasons = PRAYERS.filter(({ id }) => d.why[id]).map(({ id, en }) => {
    const w = d.why[id]!, r = reasonOf(w.r)!;
    return `${en}: ${r.label}${r.excuse ? (excused(w) ? " ✓" : " (not prayed properly)") : ""}`;
  }).join(" · ");
  row.excused = PRAYERS.filter(({ id }) => excused(d.why[id])).length;
  const c = d.checkin;
  row.slept = c.slept;
  row.woke = c.woke;
  row.sleepH = sleepHours(c);
  row.phone = c.phone == null ? null : (["None", "A bit", "A lot"] as const)[c.phone];
  row.energy = c.energy;
  row.mood = c.mood;
  row.slip = c.slip;
  row.tawbah = c.slip ? c.tawbah : false;
  row.checkin = checkinDone(c);
  row.revised = revPages(d.rev);
  row.revRanges = d.rev.map((r) => (r.from === r.to ? `${r.from}` : `${r.from}–${r.to}`)).join(", ");
  // Context for reminders and the weekly letter.
  row.tz = prefs.prayerLoc.tz;
  row.lang = prefs.lang;
  row.name = prefs.name;
  if (typeof location !== "undefined") row.app = location.origin;
  return row;
}

type Reply = { ok: boolean; schema?: number; error?: string; status?: number; days?: number; sheet?: string; saved?: number; blind?: boolean; ai?: string; processError?: string; drive?: string; next?: number; restart?: boolean; data?: string; mime?: string; docs?: Record<string, import("./types").DocInfo> };

/**
 * POST as text/plain (a "simple" request, so the browser sends no preflight that Apps Script would reject).
 * `verify` requires a readable JSON reply; otherwise a CORS-blocked read falls back to a fire-and-forget send,
 * which is safe because the script matches rows by date.
 */
export async function postToSheet(url: string, body: object, verify = false): Promise<Reply> {
  const payload = JSON.stringify(body);
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { ok: false, error: "offline" };
  try {
    const r = await fetch(url.trim(), { method: "POST", body: payload, redirect: "follow" });
    let j: Reply;
    try { j = (await r.json()) as Reply; } catch { return { ok: false, error: verify ? "unreachable" : "Unexpected reply from the sheet", status: r.status }; }
    return j && typeof j.ok === "boolean" ? j : { ok: false, error: "Unexpected reply from the sheet" };
  } catch {
    if (verify) return { ok: false, error: "unreachable" };
    try {
      await fetch(url.trim(), { method: "POST", body: payload, mode: "no-cors" });
      return { ok: true, blind: true };
    } catch {
      return { ok: false, error: "offline" };
    }
  }
}
