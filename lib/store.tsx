"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { DEFAULT_PREFS, MAX, MOHAMED_PREFS, STORAGE_KEY, type Pillar } from "./constants";
import { getName, setLocaleState, tr } from "./i18n";
import { addDays, todayKey } from "./dates";
import { ask, burst, floatPoints, haptic, pointOf, toast } from "./fx";
import { countWords, GRACE_MS, isSealed, overwrites, UNLOCK_MINUTES, UNLOCK_WORDS } from "./guard";
import { isMax, normalizeDay, scoreDay, ZERO } from "./scoring";
import { buildRow, EMPTY_SHEET, postToSheet, type SheetState, type SyncStatus } from "./sheetSync";
import type { DayLog, DocInfo, Prefs, Scores, StoredData, Timers } from "./types";
import { fromBase64, getPhoto, posterId, putPhoto, toBase64 } from "./photos";
import type { PhotoRef } from "./types";

/** Video upload piece size: a multiple of 256 KB, as Google Drive requires. */
const VIDEO_CHUNK = 3 * 1024 * 1024;

export type View = "today" | "journal" | "record";
type PointerLike = { clientX?: number; clientY?: number } | null | undefined;
export interface UpdateOpts {
  /** Skip the "change what you logged?" popup (timers, deliberate saves that already asked). */
  noConfirm?: boolean;
}

interface StoreValue {
  hydrated: boolean;
  days: Record<string, DayLog>;
  prefs: Prefs;
  timers: Timers;
  cur: string;
  dir: number;
  view: View;
  day: DayLog;
  scores: Scores;
  scoresOf: (k: string) => Scores | null;
  goTo: (k: string) => void;
  shiftDay: (n: number) => void;
  setView: (v: View) => void;
  update: (mutate: (d: DayLog) => void, e?: PointerLike, quiet?: boolean, opts?: UpdateOpts) => Promise<boolean>;
  /** True when the current day is sealed (older than 3 days) and not unlocked. */
  locked: boolean;
  isLocked: (date: string) => boolean;
  unlockFor: string | null;
  requestUnlock: (date: string | null) => void;
  unlockDay: (date: string, reason: string) => boolean;
  unlockedUntil: Record<string, number>;
  setPrefs: (p: Partial<Prefs>) => void;
  setTimers: (fn: (t: Timers) => Timers) => void;
  importData: (data: unknown) => number;
  exportData: () => string;
  sheet: SheetState;
  syncStatus: SyncStatus;
  syncError: string;
  connectSheet: (url: string) => Promise<{ ok: boolean; error?: string; days?: number; sheet?: string }>;
  disconnectSheet: () => void;
  resendAll: () => void;
  syncNow: () => void;
  docs: Record<string, DocInfo>;
  polishDay: (date: string) => Promise<{ ok: boolean; error?: string }>;
  lookupDocs: (dates: string[]) => void;
  /** Photo ids currently uploading to Drive, and ones that failed (id → error). */
  photoUp: { busy: string | null; failed: Record<string, string>; progress: Record<string, number> };
  /** Fetch a photo back from Drive when it isn't on this phone (new phone, restored backup). */
  fetchPhoto: (id: string, drive: string, date: string) => Promise<boolean>;
}

const Ctx = createContext<StoreValue | null>(null);

const CELEBRATE: Record<Pillar, string> = {
  p: "All five prayers in jamāʿah before the takbīr ✦",
  q: "Qur'an section complete. Mā shāʾ Allāh.",
  w: "3 hours on MuslimPreneur. Full marks.",
  s: "Walk target smashed.",
};

function load(): StoredData {
  const empty: StoredData = { days: {}, prefs: { ...DEFAULT_PREFS }, timers: {}, sheet: { ...EMPTY_SHEET }, docs: {} };
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!raw) return empty;
    const days: Record<string, DayLog> = {};
    for (const k in raw.days ?? {}) days[k] = normalizeDay(raw.days[k]);
    // Installs from before profiles existed belong to Mohamed: keep his settings and skip the welcome screen.
    const legacy = raw.prefs && raw.prefs.name === undefined ? MOHAMED_PREFS : {};
    return { days, prefs: { ...DEFAULT_PREFS, ...legacy, ...(raw.prefs ?? {}) }, timers: raw.timers ?? {}, sheet: { ...EMPTY_SHEET, ...(raw.sheet ?? {}) }, docs: raw.docs ?? {} };
  } catch {
    return empty;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [days, setDays] = useState<Record<string, DayLog>>({});
  const [prefs, setPrefsState] = useState<Prefs>({ ...DEFAULT_PREFS });
  const [timers, setTimersState] = useState<Timers>({});
  const [cur, setCur] = useState("");
  const [dir, setDir] = useState(0);
  const [view, setView] = useState<View>("today");
  const [sheet, setSheet] = useState<SheetState>({ ...EMPTY_SHEET });
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("off");
  const [syncError, setSyncError] = useState("");
  const [retryTick, setRetryTick] = useState(0);
  const [docs, setDocs] = useState<Record<string, DocInfo>>({});
  const mergeDocs = useCallback((d?: Record<string, DocInfo>) => {
    if (d && Object.keys(d).length) setDocs((x) => ({ ...x, ...d }));
  }, []);
  const daysRef = useRef(days);
  daysRef.current = days;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const inFlight = useRef(false);
  const graceRef = useRef<Record<string, number>>({});
  const [unlockedUntil, setUnlockedUntil] = useState<Record<string, number>>({});
  const unlockedRef = useRef(unlockedUntil);
  unlockedRef.current = unlockedUntil;
  const [unlockFor, setUnlockFor] = useState<string | null>(null);
  const [lockTick, setLockTick] = useState(0);
  const isLocked = useCallback((date: string) => isSealed(date) && !((unlockedRef.current[date] || 0) > Date.now()), []);
  // Re-seal a day when its unlock window runs out.
  useEffect(() => {
    const next = Math.min(...Object.values(unlockedUntil).filter((t) => t > Date.now()), Infinity);
    if (!isFinite(next)) return;
    const t = setTimeout(() => setLockTick((x) => x + 1), next - Date.now() + 50);
    return () => clearTimeout(t);
  }, [unlockedUntil, lockTick]);

  /** Queue dates to be (re)sent to the Google Sheet. */
  const markDirty = useCallback((dates: string[]) => {
    if (!sheetRef.current.url || !dates.length) return;
    const stamp = Date.now();
    setSheet((sh) => {
      const pending = { ...sh.pending };
      for (const d of dates) pending[d] = stamp;
      return { ...sh, pending };
    });
  }, []);

  useEffect(() => {
    const d = load();
    setDays(d.days);
    setPrefsState(d.prefs);
    setTimersState(d.timers);
    setSheet(d.sheet ?? { ...EMPTY_SHEET });
    setDocs(d.docs ?? {});
    setSyncStatus(d.sheet?.url ? "idle" : "off");
    setCur(todayKey());
    setHydrated(true);
  }, []);

  // Persist after every change (debounced so slider drags don't hammer storage).
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ days, prefs, timers, sheet, docs }));
      } catch {
        /* storage full or blocked */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [days, prefs, timers, sheet, docs, hydrated]);

  // Roll over to the new day if the app stays open past midnight.
  useEffect(() => {
    const onVis = () => {
      if (!document.hidden) setCur((c) => (c > todayKey() ? todayKey() : c));
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  const scoresOf = useCallback((k: string) => (days[k] ? scoreDay(days[k]) : null), [days]);

  const curRef = useRef(cur);
  curRef.current = cur;
  const goTo = useCallback((k: string) => {
    const t = todayKey();
    const next = k > t ? t : k;
    const c = curRef.current;
    if (next === c) return;
    setDir(next < c ? -1 : 1);
    setCur(next);
    haptic(6);
  }, []);
  const shiftDay = useCallback((n: number) => goTo(addDays(curRef.current, n)), [goTo]);

  const update = useCallback(
    async (mutate: (d: DayLog) => void, e?: PointerLike, quiet?: boolean, opts: UpdateOpts = {}) => {
      const cur = curRef.current;
      if (isLocked(cur)) {
        setUnlockFor(cur);
        haptic([10, 40, 10]);
        return false;
      }
      if (!opts.noConfirm) {
        const probe = normalizeDay(daysRef.current[cur]);
        mutate(probe);
        const ow = overwrites(daysRef.current[cur], probe);
        const now = Date.now();
        const need = ow.filter((o) => !((graceRef.current[`${cur}|${o.field}`] || 0) > now));
        if (need.length) {
          haptic(8);
          const ok = await ask({
            title: need.length === 1 ? tr("Change what you logged?") : tr("Change these?"),
            lines: need.map((o) => o.text),
            confirmLabel: tr("Yes, change it"),
            cancelLabel: tr("Keep it"),
          });
          if (!ok) return false;
        }
        for (const o of ow) graceRef.current[`${cur}|${o.field}`] = Date.now() + GRACE_MS;
      }
      const prev = daysRef.current[cur];
      const before = prev ? scoreDay(prev) : ZERO;
      const next = normalizeDay(prev);
      mutate(next);
      const after = scoreDay(next);
      daysRef.current = { ...daysRef.current, [cur]: next };
      setDays((ds) => ({ ...ds, [cur]: next }));
      // A change in pages memorised shifts the portion of every later day, so resend those too.
      const memChanged = (prev?.quran.mem ?? 0) !== next.quran.mem;
      markDirty(memChanged ? [cur, ...Object.keys(daysRef.current).filter((k) => k > cur)] : [cur]);
      if (quiet) return true;

      const diff = after.total - before.total;
      const pt = pointOf(e);
      floatPoints(pt.x, pt.y, diff);
      haptic(diff > 0 ? 12 : 6);

      if (after.total >= 99.95 && before.total < 99.95) {
        const ring = document.getElementById("score-ring")?.getBoundingClientRect();
        burst(ring ? ring.left + ring.width / 2 : pt.x, ring ? ring.top + ring.height / 2 : pt.y, true);
        toast(getName() ? tr("100 out of 100. Perfect day, {name}. Al-ḥamdu lillāh.", { name: getName() }) : tr("100 out of 100. Perfect day. Al-ḥamdu lillāh."));
        haptic([20, 40, 20, 40, 60]);
        return true;
      }
      for (const k of Object.keys(MAX) as Pillar[]) {
        if (isMax(k, after[k]) && !isMax(k, before[k])) {
          burst(pt.x, pt.y);
          toast(tr(CELEBRATE[k]));
          break;
        }
      }
      return true;
    },
    [markDirty, isLocked],
  );

  /** Reopen a sealed day for a while, once a reason of at least 100 words is given. */
  const unlockDay = useCallback((date: string, reason: string) => {
    if (countWords(reason) < UNLOCK_WORDS) return false;
    const next = normalizeDay(daysRef.current[date]);
    next.unlocks = [...(next.unlocks ?? []), { at: new Date().toISOString(), reason: reason.trim() }];
    daysRef.current = { ...daysRef.current, [date]: next };
    setDays((ds) => ({ ...ds, [date]: next }));
    setUnlockedUntil((u) => ({ ...u, [date]: Date.now() + UNLOCK_MINUTES * 60_000 }));
    unlockedRef.current = { ...unlockedRef.current, [date]: Date.now() + UNLOCK_MINUTES * 60_000 };
    setUnlockFor(null);
    return true;
  }, []);

  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((x) => ({ ...x, ...p }));
    // Only the Qur'an start point changes what is sent to the sheet.
    if ("basePage" in p || "baseDate" in p) markDirty(Object.keys(daysRef.current));
  }, [markDirty]);
  const setTimers = useCallback((fn: (t: Timers) => Timers) => setTimersState((t) => fn({ ...t })), []);

  const exportData = useCallback(
    () => JSON.stringify({ app: "muhasaba", version: 2, exported: new Date().toISOString(), prefs, days }, null, 1),
    [prefs, days],
  );

  const importData = useCallback((data: unknown) => {
    const j = data as { app?: string; days?: Record<string, Partial<DayLog>>; prefs?: Partial<Prefs> };
    if (!j || j.app !== "muhasaba" || typeof j.days !== "object") throw new Error("Not a Muhasaba backup");
    let n = 0;
    const incoming: Record<string, DayLog> = {};
    for (const k in j.days) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(k)) {
        incoming[k] = normalizeDay(j.days[k]);
        n++;
      }
    }
    setDays((ds) => ({ ...ds, ...incoming }));
    if (j.prefs) setPrefsState((p) => ({ ...p, ...j.prefs }));
    markDirty(Object.keys(incoming));
    return n;
  }, [markDirty]);

  /* ---------- Google Sheet sync ---------- */
  const flush = useCallback(async () => {
    const sh = sheetRef.current;
    if (!sh.url || inFlight.current) return;
    const batch = Object.entries(sh.pending).slice(0, 120);
    if (!batch.length) return;
    inFlight.current = true;
    setSyncStatus("syncing");
    const rows = batch.filter(([k]) => daysRef.current[k]).map(([k]) => buildRow(k, daysRef.current, prefsRef.current));
    const res = rows.length ? await postToSheet(sh.url, { rows }) : { ok: true };
    inFlight.current = false;
    if ("docs" in res) mergeDocs(res.docs);
    if (res.ok) {
      setSheet((cur) => {
        const pending = { ...cur.pending };
        // Only clear entries that were not edited again while this batch was in the air.
        for (const [k, v] of batch) if (pending[k] === v) delete pending[k];
        return { ...cur, pending, lastSync: Date.now() };
      });
      setSyncError("");
      setSyncStatus("ok");
    } else {
      setSyncStatus(res.error === "offline" ? "offline" : "error");
      setSyncError(res.error === "offline" ? "" : res.error || "Couldn't reach the sheet");
      setTimeout(() => setRetryTick((t) => t + 1), 30000);
    }
  }, [mergeDocs]);

  // Send a few seconds after the last change, and keep going until the queue is empty.
  const pendingCount = Object.keys(sheet.pending).length;
  useEffect(() => {
    if (!hydrated || !sheet.url || !pendingCount) return;
    setSyncStatus((s) => (s === "syncing" ? s : "waiting"));
    const t = setTimeout(flush, 2500);
    return () => clearTimeout(t);
  }, [hydrated, sheet.url, sheet.pending, pendingCount, retryTick, flush]);

  useEffect(() => {
    const kick = () => setRetryTick((t) => t + 1);
    const onVis = () => { if (!document.hidden) kick(); };
    addEventListener("online", kick);
    document.addEventListener("visibilitychange", onVis);
    return () => { removeEventListener("online", kick); document.removeEventListener("visibilitychange", onVis); };
  }, []);

  const connectSheet = useCallback(async (url: string) => {
    const res = await postToSheet(url, { ping: true }, true);
    if (!res.ok) return res;
    const stamp = Date.now();
    const pending: Record<string, number> = {};
    for (const k of Object.keys(daysRef.current)) pending[k] = stamp;
    const next: SheetState = { url: url.trim(), pending, lastSync: Date.now(), sheetName: res.sheet };
    sheetRef.current = next;
    setSheet(next);
    setSyncStatus(Object.keys(pending).length ? "waiting" : "ok");
    setSyncError("");
    return res;
  }, []);

  const disconnectSheet = useCallback(() => {
    setSheet({ ...EMPTY_SHEET });
    setSyncStatus("off");
    setSyncError("");
  }, []);

  /** Send this day now and ask the script to polish it into its Google Doc straight away. */
  const polishDay = useCallback(async (date: string) => {
    const sh = sheetRef.current;
    if (!sh.url) return { ok: false, error: tr("Connect your Google Sheet first (Record tab).") };
    if (!daysRef.current[date]) return { ok: false, error: tr("Nothing written for this day yet.") };
    const row = buildRow(date, daysRef.current, prefsRef.current);
    const res = await postToSheet(sh.url, { rows: [row], process: date }, true);
    mergeDocs(res.docs);
    if (res.ok) {
      setSheet((cur) => { const pending = { ...cur.pending }; delete pending[date]; return { ...cur, pending, lastSync: Date.now() }; });
      if (res.processError) return { ok: false, error: res.processError };
      return { ok: true };
    }
    return { ok: false, error: res.error === "offline" ? tr("You're offline.") : res.error === "unreachable" ? tr("Google sent back an error page. Open your Apps Script → Exécutions to see why (usually: run setup, click Autoriser, then publish a new version).") : res.error };
  }, [mergeDocs]);

  const lookupDocs = useCallback((dates: string[]) => {
    const sh = sheetRef.current;
    if (!sh.url || !dates.length) return;
    void postToSheet(sh.url, { lookup: dates }, true).then((r) => mergeDocs(r.docs));
  }, [mergeDocs]);

  /* ---------- Journal photos → Google Drive ---------- */
  const [photoUp, setPhotoUp] = useState<{ busy: string | null; failed: Record<string, string>; progress: Record<string, number> }>({ busy: null, failed: {}, progress: {} });
  const photoBusy = useRef(false);
  const photoFailedAt = useRef<Record<string, number>>({});
  /** Change a day without the lock or the confirm popup (used to record a finished upload). */
  const patchDay = useCallback((date: string, fn: (d: DayLog) => void) => {
    if (!daysRef.current[date]) return;
    const next = normalizeDay(daysRef.current[date]);
    fn(next);
    daysRef.current = { ...daysRef.current, [date]: next };
    setDays((ds) => ({ ...ds, [date]: next }));
    markDirty([date]);
  }, [markDirty]);

  const uploadPhotos = useCallback(async () => {
    const sh = sheetRef.current;
    if (!sh.url || photoBusy.current || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
    const now = Date.now();
    let job: { date: string; ref: PhotoRef } | null = null;
    for (const date of Object.keys(daysRef.current).sort().reverse()) {
      for (const e of daysRef.current[date].journal) for (const p of e.photos ?? []) {
        const todo = p.kind === "video" ? !p.poster || !p.drive : !p.drive;
        if (todo && !((photoFailedAt.current[p.id] || 0) > now - 60000)) { job = { date, ref: p }; break; }
      }
      if (job) break;
    }
    if (!job) return;
    const { date, ref } = job;
    const id = ref.id;
    const setRef = (fn: (p: PhotoRef) => void) => patchDay(date, (d) => { for (const e of d.journal) for (const p of e.photos ?? []) if (p.id === id) fn(p); });
    const fail = (res: { ok: boolean; error?: string }) => {
      photoFailedAt.current[id] = Date.now();
      const msg = res.error === "offline" ? "" : res.error === "unreachable" ? tr("Google sent back an error page. Publish a new version of your Apps Script (Déployer → Gérer les déploiements).") : res.ok ? tr("Your Apps Script is out of date. Paste the new Code.gs and publish a new version.") : res.error || "";
      setPhotoUp((u) => ({ busy: null, progress: u.progress, failed: msg ? { ...u.failed, [id]: msg } : u.failed }));
      setTimeout(() => setRetryTick((t) => t + 1), 60000);
    };
    const done = () => {
      setPhotoUp((u) => { const failed = { ...u.failed }; delete failed[id]; const progress = { ...u.progress }; delete progress[id]; return { busy: null, failed, progress }; });
      setTimeout(() => setRetryTick((t) => t + 1), 300);
    };

    photoBusy.current = true;
    setPhotoUp((u) => ({ ...u, busy: id }));
    try {
      if (ref.kind === "video" && !ref.poster) {
        // 1. the cover picture, saved like a photo
        const rec = await getPhoto(posterId(id));
        if (!rec) { photoFailedAt.current[id] = Date.now() + 1e12; setPhotoUp((u) => ({ ...u, busy: null })); return; }
        const res = await postToSheet(sh.url, { photo: { id: posterId(id), date, mime: "image/jpeg", data: await toBase64(rec.blob) } }, true);
        if (res.ok && res.drive) { setRef((p) => { p.poster = res.drive; }); done(); } else fail(res);
        return;
      }
      const rec = await getPhoto(id);
      if (!rec) { photoFailedAt.current[id] = Date.now() + 1e12; setPhotoUp((u) => ({ ...u, busy: null })); return; } // not on this phone
      if (ref.kind !== "video") {
        const res = await postToSheet(sh.url, { photo: { id, date, mime: rec.blob.type || "image/jpeg", data: await toBase64(rec.blob) } }, true);
        if (res.ok && res.drive) { setRef((p) => { p.drive = res.drive; }); done(); } else fail(res);
        return;
      }
      // 2. the video itself, in 3 MB pieces. The script remembers how far it got, so a dropped connection resumes.
      const total = rec.blob.size;
      const mime = rec.blob.type || "video/mp4";
      const base = { id, date, mime, total };
      let res = await postToSheet(sh.url, { video: base }, true);
      if (!res.ok && res.error === "unreachable") {
        fail({ ok: false, error: tr("Your Apps Script didn't answer for the video. Make sure the newest Code.gs is pasted, then Déployer → Gérer les déploiements → ✏️ → Nouvelle version. It retries by itself.") });
        return;
      }
      // Pieces shrink on a weak connection (3 MB → 1 MB → 512 KB, all multiples of 256 KB as Drive requires).
      let chunk = VIDEO_CHUNK;
      let next = 0;
      let misses = 0;
      for (let guard = 0; guard < 2000; guard++) {
        if (!res.ok) {
          if (res.error === "offline" || misses >= 4) {
            fail(res.error === "unreachable" ? { ok: false, error: tr("The video upload keeps getting cut off. It will continue by itself from {n}% when the connection is better.", { n: Math.round((next / total) * 100) }) } : res);
            return;
          }
          misses++;
          chunk = Math.max(512 * 1024, chunk / 2 >= 1024 * 1024 ? 1024 * 1024 : 512 * 1024);
          res = await postToSheet(sh.url, { video: base }, true); // ask how far it got, then carry on
          continue;
        }
        if (res.drive) { setRef((p) => { p.drive = res.drive; }); done(); return; }
        if (typeof res.next !== "number") { fail({ ok: true }); return; }
        next = res.next;
        setPhotoUp((u) => ({ ...u, progress: { ...u.progress, [id]: next / total } }));
        const piece = rec.blob.slice(next, Math.min(total, next + chunk));
        res = await postToSheet(sh.url, { video: { ...base, offset: next, data: await toBase64(piece) } }, true);
        if (res.ok) misses = 0;
      }
      fail({ ok: false, error: "Upload stalled" });
    } finally {
      photoBusy.current = false;
    }
  }, [patchDay]);
  useEffect(() => { if (hydrated) void uploadPhotos(); }, [hydrated, days, sheet.url, retryTick, uploadPhotos]);

  const fetchPhoto = useCallback(async (id: string, drive: string, date: string) => {
    const sh = sheetRef.current;
    if (!sh.url) return false;
    const res = await postToSheet(sh.url, { photoGet: drive }, true);
    if (!res.ok || !res.data) return false;
    const blob = fromBase64(res.data, res.mime || "image/jpeg");
    await putPhoto({ id, date, blob, w: 0, h: 0, added: Date.now() });
    return true;
  }, []);

  const resendAll = useCallback(() => markDirty(Object.keys(daysRef.current)), [markDirty]);
  const syncNow = useCallback(() => { void flush(); }, [flush]);

  setLocaleState(prefs.lang, prefs.name, prefs.birth);
  const day = useMemo(() => normalizeDay(days[cur]), [days, cur]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const locked = useMemo(() => !!cur && isLocked(cur), [cur, unlockedUntil, lockTick, isLocked]);
  const scores = useMemo(() => (days[cur] ? scoreDay(days[cur]) : ZERO), [days, cur]);

  const value: StoreValue = {
    hydrated, days, prefs, timers, cur, dir, view, day, scores, scoresOf,
    goTo, shiftDay, setView, update, setPrefs, setTimers, importData, exportData,
    sheet, syncStatus, syncError, connectSheet, disconnectSheet, resendAll, syncNow,
    docs, polishDay, lookupDocs, photoUp, fetchPhoto,
    locked, isLocked, unlockFor, requestUnlock: setUnlockFor, unlockDay, unlockedUntil,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used inside <StoreProvider>");
  return v;
}

/** Re-render every second while something needs a live clock. */
export function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}
