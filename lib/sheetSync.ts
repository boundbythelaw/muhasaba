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
  // Rules version: days logged before an update keep their old scoring; new fields say "n/a" there.
  const v2 = (d.v ?? 1) >= 2;
  const na = "n/a";
  row.rules = d.v ?? 1;
  const lateTxt = PRAYERS.filter(({ id }) => d.prayers[id] === 1 && d.late[id]).map(({ en, id }) => `${en} ⏱ ${d.late[id]!.m === 0 ? "right after takbīr" : `missed ${d.late[id]!.m}/${d.late[id]!.of} rakʿah`}`);
  if (lateTxt.length) row.reasons = [lateTxt.join(" · "), row.reasons].filter(Boolean).join(" · ");
  const FOCUS_TXT = ["mostly elsewhere", "on and off", "present"];
  const ks = PRAYERS.filter(({ id }) => d.khushu[id]);
  row.khushu = !v2 ? na : ks.length ? Math.round((ks.reduce((n, { id }) => n + d.khushu[id]!.f, 0) / (ks.length * 2)) * 100) : null;
  row.khushuNote = !v2 ? na : ks.map(({ id, en }) => {
    const k = d.khushu[id]!;
    const extra = [...k.what, ...k.why].join(", ");
    return `${en}: ${FOCUS_TXT[k.f]}${extra ? ` (${extra})` : ""}${k.back != null && k.f < 2 ? ` · back ${["never", "after a while", "at once"][k.back]}` : ""}${k.note ? ` · “${k.note}”` : ""}`;
  }).join(" · ");
  row.workout = !v2 ? na : d.workout.done ? ["✓", d.workout.minutes ? `${d.workout.minutes} min` : "", d.workout.kinds.join(", ")].filter(Boolean).join(" · ") : "";
  row.tathbit = !v2 ? na : d.tathbit.page ? `p. ${d.tathbit.page} · ${d.tathbit.mem}/10 + ${d.tathbit.read}/10` : "";
  row.salawat = !v2 ? na : d.dhikr.salawat || null;
  row.tasbih = !v2 ? na : d.dhikr.tasbih || null;
  row.music = d.quran.music == null ? (v2 ? null : na) : ["None", "A little", "Yes"][d.quran.music];
  const ur = d.sc.urges;
  row.sc = !v2 ? na : ur.length || d.sc.relapse ? `${ur.filter((u) => u.ok).length}/${ur.length} urges beaten${d.sc.relapse ? " · slipped" : ""}` : "";
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

type Reply = { ok: boolean; schema?: number; error?: string; status?: number; days?: number; sheet?: string; saved?: number; blind?: boolean; ai?: string; processError?: string; drive?: string; next?: number; restart?: boolean; data?: string; mime?: string; docs?: Record<string, import("./types").DocInfo>; future?: FutureLetter[] };

/** A sealed or delivered letter to future me, as the script lists it (never with its text). */
export interface FutureLetter { id: string; written: string; due: string; status: "sealed" | "delivered"; words: number; media?: number; url: string }

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
