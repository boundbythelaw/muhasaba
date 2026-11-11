import { PRAYERS } from "./constants";
import { addDays, todayKey } from "./dates";
import { num, tr } from "./i18n";
import { BONUS_ITEMS, RAWATIB } from "./bonus";
import type { DayLog } from "./types";

/** Today and the two days before stay editable; from the third day a day is sealed. */
export const EDITABLE_DAYS = 3;
export const UNLOCK_WORDS = 100;
export const UNLOCK_MINUTES = 15;
/** After you confirm a change to a field, further changes to it skip the popup for this long. */
export const GRACE_MS = 60_000;

export const isSealed = (date: string, today = todayKey()) => date < addDays(today, -(EDITABLE_DAYS - 1));

export const countWords = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

const PRAYER_LABEL = ["No mosque", "Mosque (late)", "Before takbīr"];
const CHECKS: Record<string, string> = {
  preview: "Previewed tomorrow's pages",
  juz: "Read 1 juz",
  mulkSubh: "Al-Mulk after Subh",
  mulkMaghrib: "Al-Mulk after Maghrib",
};
const DIFF: Record<string, string> = { easy: "Easy", normal: "Normal", hard: "Hard" };
const pages = (n: number) => (n === 1 ? tr("1 page") : tr("{n} pages", { n }));
const steps = (n: number | null) => (n ? tr("{n} steps", { n: num(n) }) : tr("not set"));

export interface Overwrite {
  /** Stable field id, used for the grace period. */
  field: string;
  /** What changes, in plain words. */
  text: string;
}

/**
 * Lists the changes that overwrite or remove something already logged.
 * Setting a value for the first time is not an overwrite, and free-text notes are left out on purpose.
 */
export function overwrites(prev: DayLog | undefined, next: DayLog): Overwrite[] {
  if (!prev) return [];
  const out: Overwrite[] = [];
  for (const { id, en } of PRAYERS) {
    const a = prev.prayers[id], b = next.prayers[id];
    if (a != null && a !== b) out.push({ field: `prayer:${id}`, text: `${tr(en)}: ${tr(PRAYER_LABEL[a])} → ${b == null ? tr("not set") : tr(PRAYER_LABEL[b])}` });
  }
  const r0 = prev.rev ?? [], r1 = next.rev ?? [];
  if (r1.length < r0.length) {
    const gone = r0.find((r) => !r1.some((x) => x.from === r.from && x.to === r.to));
    if (gone) out.push({ field: `rev:${gone.from}-${gone.to}`, text: tr("Remove revised pages {a}–{b}", { a: gone.from, b: gone.to }) });
  }
  const q0 = prev.quran, q1 = next.quran;
  if (q0.mem > 0 && q0.mem !== q1.mem) out.push({ field: "mem", text: `${tr("Memorised")}: ${pages(q0.mem)} → ${q1.mem ? pages(q1.mem) : tr("not yet")}` });
  if (q0.minutes != null && q0.minutes !== q1.minutes) out.push({ field: "minutes", text: `${tr("Memorisation time")}: ${q0.minutes} min → ${q1.minutes == null ? tr("not set") : q1.minutes + " min"}` });
  if (q0.diff && q0.diff !== q1.diff) out.push({ field: "diff", text: `${tr("Difficulty")}: ${tr(DIFF[q0.diff])} → ${q1.diff ? tr(DIFF[q1.diff]) : tr("not set")}` });
  for (const k of Object.keys(CHECKS) as (keyof typeof CHECKS)[]) {
    const key = k as "preview" | "juz" | "mulkSubh" | "mulkMaghrib";
    if (q0[key] && !q1[key]) out.push({ field: key, text: tr("Untick “{x}”", { x: tr(CHECKS[k]) }) });
  }
  if (prev.work.hours > 0 && prev.work.hours !== next.work.hours) out.push({ field: "hours", text: `MuslimPreneur: ${prev.work.hours}h → ${next.work.hours}h` });
  for (const t of prev.work.topics) if (!next.work.topics.includes(t)) out.push({ field: `topic:${t}`, text: tr("Remove topic “{x}”", { x: tr(t) }) });
  if (prev.steps && prev.steps !== next.steps) out.push({ field: "steps", text: `${tr("Steps")}: ${steps(prev.steps)} → ${steps(next.steps)}` });
  for (const it of BONUS_ITEMS) if (prev.bonus[it.id] && !next.bonus[it.id]) out.push({ field: `bonus:${it.id}`, text: tr("Untick “{x}”", { x: tr(it.label) }) });
  for (const r of RAWATIB) if (prev.bonus.rawatib[r.id] && !next.bonus.rawatib[r.id]) out.push({ field: `rawatib:${r.id}`, text: tr("Untick “{x}”", { x: tr(r.label) }) });
  for (const e of prev.journal) {
    const n = next.journal.find((x) => x.id === e.id);
    const short = !e.text.trim() ? tr("Photo") : e.text.length > 48 ? e.text.slice(0, 48) + "…" : e.text;
    if (!n) out.push({ field: `journal:${e.id}`, text: tr("Delete the {t} entry: “{x}”", { t: e.t, x: short }) });
    else if (n.text.trim() !== e.text.trim() || n.t !== e.t) out.push({ field: `journal:${e.id}`, text: tr("Edit the {t} entry: “{x}”", { t: e.t, x: short }) });
    if (n) for (const p of e.photos ?? []) if (!(n.photos ?? []).some((x) => x.id === p.id)) out.push({ field: `photo:${p.id}`, text: tr(p.kind === "video" ? "Remove a video from the {t} entry" : "Remove a photo from the {t} entry", { t: e.t }) });
  }
  return out;
}
