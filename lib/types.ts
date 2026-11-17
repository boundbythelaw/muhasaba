import type { PrayerId } from "./constants";

/** 0 = prayed without the mosque, 1 = mosque but late, 2 = mosque before the takbīr */
export type PrayerMark = 0 | 1 | 2;
export type Difficulty = "easy" | "normal" | "hard";

export interface QuranLog {
  /** Pages memorised that day (0, 1, 2, or more). */
  mem: number;
  minutes: number | null;
  diff: Difficulty | null;
  preview: boolean;
  /** Murājaʿa done: today's juz read (+5). */
  juz: boolean;
  /** Which juz the murājaʿa covered; tomorrow's suggestion continues from it. */
  revJuz?: number;
  mulkSubh: boolean;
  mulkMaghrib: boolean;
}

export interface WorkLog {
  hours: number;
  topics: string[];
  note: string;
}

export interface JournalEntry {
  id: string;
  /** "HH:MM", local time */
  t: string;
  text: string;
  /** Photos attached to this entry. `drive` is set once the copy is saved in Google Drive. */
  photos?: PhotoRef[];
}

/**
 * A photo or video on a journal entry. `drive` is set once the file is in Google Drive.
 * Videos also carry a cover picture (`poster`, its Drive id once uploaded) and their length in seconds.
 */
export interface PhotoRef { id: string; drive?: string; kind?: "video"; poster?: string; dur?: number }

export type Verdict = "good" | "hard_good" | "hard";

export interface DocInfo {
  url: string;
  verdict: Verdict | "";
  title: string;
  summary: string;
  pending: boolean;
  /** What went wrong at the last polish (AI or photos), if anything. */
  error?: string;
}

/** Why a prayer was late or missed at the mosque. The first four are valid excuses (full points when prayed properly). */
export type PrayerReason = "travel" | "ill" | "period" | "weather" | "nature" | "slept" | "phone" | "work" | "lazy" | "outage" | "other";
export interface PrayerWhy { r: PrayerReason; /** for an excuse: prayed it the way the Sunnah allows */ ok?: boolean }

/** The required evening check-in. Sleep is the night before this day. */
export interface Checkin {
  slept: string | null; // "HH:MM" went to sleep (last night)
  woke: string | null; // "HH:MM" woke up (this morning)
  phone: 0 | 1 | 2 | null; // scrolling: none / a bit / a lot
  energy: number | null; // 1–5
  mood: number | null; // 1–5
  slip: boolean; // "I slipped today" (private)
  tawbah: boolean;
}

/** A murājaʿa (revision) range, Mushaf pages inclusive. */
export interface RevRange { from: number; to: number }

/** Khushūʿ after a prayer. f: 2 present · 1 on and off · 0 mostly elsewhere. back: 2 at once · 1 after a while · 0 didn't. */
export interface Khushu { f: 0 | 1 | 2; what: string[]; why: string[]; back: 0 | 1 | 2 | null; note?: string }
/** Late to the mosque: rakʿahs missed (0 = joined right after the takbīr) out of the prayer's total. */
export interface Late { m: number; of: number }
export interface Tathbit { page: number | null; mem: number; read: number }
export interface Workout { done: boolean; minutes: number | null; kinds: string[] }
export interface Urge { t: string; trig: string[]; ok: boolean }
/** Self-control (private). `relapse` marks a slip that day. */
export interface SelfControl { urges: Urge[]; relapse: boolean }

export interface DayLog {
  /** Scoring rules this day is counted with (1 = before the v2 update). Old days keep their old scores. */
  v: number;
  prayers: Partial<Record<PrayerId, PrayerMark>>;
  late: Partial<Record<PrayerId, Late>>;
  khushu: Partial<Record<PrayerId, Khushu>>;
  tathbit: Tathbit;
  workout: Workout;
  sc: SelfControl;
  why: Partial<Record<PrayerId, PrayerWhy>>;
  checkin: Checkin;
  rev: RevRange[];
  quran: QuranLog;
  work: WorkLog;
  steps: number | null;
  shukr: string;
  journal: JournalEntry[];
  bonus: import("./bonus").BonusLog;
  /** Reasons given when a sealed day was reopened. */
  unlocks?: { at: string; reason: string }[];
}

export interface Prefs {
  basePage: number;
  baseDate: string;
  lang: import("./i18n").Lang;
  name: string;
  /** "YYYY-MM-DD", or "" if not set */
  birth: string;
  /** False until the welcome screen has been completed on a new install. */
  welcomed: boolean;
  prayerLoc: import("./prayerTimes").PrayerLocation;
  asr: "standard" | "hanafi";
  /** Shows the menstruation excuse for women. */
  gender: "m" | "f" | "";
  /** Day the self-control streak started being tracked. */
  scStart?: string;
  /** Next Baqarah page for tathbīt (re-memorisation). */
  tathbitNext?: number;
  /** Last "What's new" version seen. */
  seenUpdate?: number;
}

export interface RunningTimer {
  day: string;
  start: number;
  topic?: string;
}

export interface Timers {
  hifz?: RunningTimer;
  work?: RunningTimer;
}

export interface Scores {
  p: number;
  q: number;
  w: number;
  s: number;
  total: number;
  /** Voluntary acts, on top of the 100 (never part of total). */
  bonus: number;
}

export interface StoredData {
  days: Record<string, DayLog>;
  prefs: Prefs;
  timers: Timers;
  sheet?: import("./sheetSync").SheetState;
  docs?: Record<string, DocInfo>;
}
