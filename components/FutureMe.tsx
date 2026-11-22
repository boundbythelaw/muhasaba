"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { addDays, hijri, keyOf, parseKey, todayKey } from "@/lib/dates";
import { ask, burst, haptic, toast } from "@/lib/fx";
import { getLang, loc, num, tr } from "@/lib/i18n";
import { deletePhoto, fmtDur, posterId, usePhotoUrl } from "@/lib/photos";
import { asSheetMedia, uploadLetterMedia } from "@/lib/futureUpload";
import { pagesBefore, scoreDay } from "@/lib/scoring";
import { postToSheet, type FutureLetter } from "@/lib/sheetSync";
import { useStore } from "@/lib/store";
import { PhotoButtons } from "./Photos";
import { BottomSheet } from "./Sheets";
import type { PhotoRef } from "@/lib/types";
import { tap } from "./ui";

const LIST_KEY = "muhasaba-future";
const DRAFT_KEY = "muhasaba-future-draft";
const SPANS = [
  { m: 6, label: "6 months" },
  { m: 7, label: "7 months" },
  { m: 12, label: "1 year" },
  { m: 24, label: "2 years" },
  { m: 36, label: "3 years" },
];
const STARTERS = ["Right now I'm…", "I hope that by now you…", "Don't forget…", "What worries me today is…", "My duʿāʾ for you:"];

/** Same day n months later (31 Jan + 1 month → 28/29 Feb). */
function addMonths(k: string, n: number) {
  const d = parseKey(k);
  const t = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
  return keyOf(new Date(t.getFullYear(), t.getMonth(), Math.min(d.getDate(), last)));
}
const longDate = (k: string) => parseKey(k).toLocaleDateString(loc(), { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const shortY = (k: string) => parseKey(k).toLocaleDateString(loc(), { day: "numeric", month: "short", year: "numeric" });
const daysUntil = (k: string) => Math.round((parseKey(k).getTime() - parseKey(todayKey()).getTime()) / 864e5);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
function read<T>(k: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(k) || "null") ?? fallback; } catch { return fallback; } }
function write(k: string, v: unknown) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } }

function spanText(from: string, to: string) {
  const d = daysUntil(to) - daysUntil(from);
  const months = Math.round(d / 30.44);
  if (months >= 12 && months % 12 === 0) return tr(months === 12 ? "1 year" : "{n} years", { n: months / 12 });
  if (months >= 1) return tr(months === 1 ? "1 month" : "{n} months", { n: months });
  return tr(d === 1 ? "1 day" : "{n} days", { n: d });
}

/**
 * Future me: write a letter now, seal it, and it comes back as a special Google Doc (plus an email) on the day
 * you choose, from 6 months to 3 years later. Once sealed, the app can't show it again: the text lives only
 * in your sheet until delivery.
 */
export default function FutureCard() {
  const { sheet } = useStore();
  const [list, setList] = useState<FutureLetter[]>([]);
  const [open, setOpen] = useState(false);
  const [sealing, setSealing] = useState(false);

  useEffect(() => { setList(read<FutureLetter[]>(LIST_KEY, [])); }, []);
  const refresh = useCallback(() => {
    if (!sheet.url) return;
    void postToSheet(sheet.url, { futureList: true }, true).then((r) => { if (r.ok && r.future) { setList(r.future); write(LIST_KEY, r.future); } });
  }, [sheet.url]);
  useEffect(() => { refresh(); }, [refresh]);

  const sealed = list.filter((l) => l.status === "sealed").sort((a, b) => a.due.localeCompare(b.due));
  const arrived = list.filter((l) => l.status === "delivered").sort((a, b) => b.due.localeCompare(a.due));

  const cancel = async (l: FutureLetter) => {
    if (!sheet.url) return;
    const ok = await ask({ title: tr("Cancel this letter?"), message: tr("It will never be delivered, and its words are deleted. This can't be undone."), confirmLabel: tr("Cancel the letter"), cancelLabel: tr("Keep it") });
    if (!ok) return;
    const r = await postToSheet(sheet.url, { futureCancel: l.id }, true);
    if (r.ok && r.future) { setList(r.future); write(LIST_KEY, r.future); toast(tr("Letter cancelled.")); }
    else toast(r.error === "offline" ? tr("You're offline.") : tr("Couldn't reach your sheet. Try again."));
  };

  return (
    <section className="card future">
      <div className="ch">
        <h2>{tr("Future me")}<span className="ar">رسالة إلى نفسي</span></h2>
        {sealed.length > 0 && <span className="badge num">✉ {sealed.length}</span>}
      </div>
      <div className="fm-hero">
        <Envelope />
        <p className="sub">{tr("Write to yourself in 6 months, a year, up to 3 years. It's sealed the moment you send it: even you can't read it until the day comes. Then it arrives as a special Google Doc, and an email tells you it's ready.")}</p>
      </div>

      {arrived.length > 0 && (
        <div className="fm-list">
          {arrived.map((l) => (
            <motion.a key={l.id} className="fm-row arrived" href={l.url} target="_blank" rel="noreferrer" {...tap}>
              <span className="fm-ic" aria-hidden="true">📬</span>
              <span className="fm-tx"><b>{tr("Arrived · written {d}", { d: shortY(l.written) })}</b><small>{tr("Open the letter ↗")}</small></span>
            </motion.a>
          ))}
        </div>
      )}
      {sealed.length > 0 && (
        <div className="fm-list">
          {sealed.map((l) => {
            const total = Math.max(1, daysUntil(l.due) - daysUntil(l.written));
            const left = Math.max(0, daysUntil(l.due));
            return (
              <div key={l.id} className="fm-row">
                <span className="fm-ic fm-sealic" aria-hidden="true"><svg viewBox="0 0 120 90"><rect x="8" y="14" width="104" height="66" rx="10" className="e-body" /><path d="M8 22 L60 54 L112 22" className="e-flap" /><circle cx="60" cy="54" r="12" className="e-seal" /></svg></span>
                <span className="fm-tx">
                  <b>{tr("Opens {d}", { d: longDate(l.due) })}</b>
                  <small className="num">{left === 0 ? tr("Arrives today, from 9:00") : tr(left === 1 ? "in 1 day" : "in {n} days", { n: num(left) })} · {tr("{n} words", { n: l.words })}{l.media ? ` · ${l.media} 📎` : ""} · {tr("sealed {d}", { d: shortY(l.written) })}</small>
                  <span className="fm-bar"><motion.i initial={{ width: 0 }} animate={{ width: `${Math.min(100, ((total - left) / total) * 100)}%` }} transition={{ type: "spring", stiffness: 60, damping: 18 }} /></span>
                </span>
                <button className="linkbtn fm-x" onClick={() => void cancel(l)} aria-label={tr("Cancel this letter")}>×</button>
              </div>
            );
          })}
        </div>
      )}

      {sheet.url ? (
        <motion.button className="dk-start fm-write" whileTap={{ scale: 0.97 }} onClick={() => { setOpen(true); haptic(10); }}>
          <span className="fm-pen" aria-hidden="true">✍️</span>
          <span><b>{tr(list.length ? "Write another letter" : "Write a letter to future me")}</b><small>{tr("Sealed until the day you pick")}</small></span>
        </motion.button>
      ) : (
        <p className="note">{tr("Connect your Google Sheet first (Record tab): it keeps your letters sealed and delivers them.")}</p>
      )}
      <Composer open={open} onClose={() => setOpen(false)} onSealed={(l) => { setList(l); write(LIST_KEY, l); setOpen(false); setSealing(true); }} />
      <AnimatePresence>{sealing && <SealMoment onDone={() => setSealing(false)} />}</AnimatePresence>
    </section>
  );
}

function Envelope() {
  return (
    <motion.svg className="fm-env" viewBox="0 0 120 90" aria-hidden="true" initial={{ rotate: -6, y: 4 }} animate={{ rotate: [-6, -3, -6], y: [4, 0, 4] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}>
      <rect x="6" y="14" width="108" height="68" rx="9" className="e-body" />
      <path d="M6 22 L60 56 L114 22" className="e-flap" />
      <circle cx="60" cy="56" r="11" className="e-seal" />
      <path d="M55 56 l4 4 l7 -8" className="e-tick" />
    </motion.svg>
  );
}

function Composer({ open, onClose, onSealed }: { open: boolean; onClose: () => void; onSealed: (l: FutureLetter[]) => void }) {
  const { sheet, days, prefs } = useStore();
  const today = todayKey();
  const [text, setText] = useState("");
  const [span, setSpan] = useState<number | "date">(12);
  const [custom, setCustom] = useState(addMonths(today, 6));
  const [media, setMedia] = useState<PhotoRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [up, setUp] = useState<{ i: number; f: number } | null>(null);
  const [err, setErr] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!open) return;
    const d = read<{ text: string; span: number | "date"; custom: string; media?: PhotoRef[] } | null>(DRAFT_KEY, null);
    if (d) { setText(d.text || ""); setSpan(d.span ?? 12); if (d.custom) setCustom(d.custom); setMedia(d.media ?? []); }
    setErr("");
  }, [open]);
  useEffect(() => { if (open) write(DRAFT_KEY, text.trim() || media.length ? { text, span, custom, media } : null); }, [text, span, custom, media, open]);
  const removeMedia = (m: PhotoRef) => {
    void deletePhoto(m.id);
    if (m.kind === "video") void deletePhoto(posterId(m.id));
    setMedia((xs) => xs.filter((x) => x.id !== m.id));
  };
  useEffect(() => { const t = ref.current; if (t) { t.style.height = "auto"; t.style.height = `${Math.max(200, t.scrollHeight)}px`; } }, [text, open]);

  const minDate = addMonths(today, 1), maxDate = addDays(addMonths(today, 36), 0);
  const due = span === "date" ? custom : addMonths(today, span);
  const valid = (text.trim().length > 0 || media.length > 0) && due >= minDate && due <= maxDate;
  const snap = useMemo(() => {
    const last = Array.from({ length: 30 }, (_, i) => addDays(today, -i)).filter((k) => days[k]);
    const avg30 = last.length ? last.reduce((a, k) => a + scoreDay(days[k]).total, 0) / last.length : null;
    return { avg30, page: pagesBefore(days, prefs, addDays(today, 1)) };
  }, [days, prefs, today]);

  const seal = async () => {
    if (!valid || !sheet.url) return;
    setBusy(true); setErr("");
    let sent = media;
    try {
      if (media.length) {
        sent = await uploadLetterMedia(sheet.url, today, media, (m) => { setMedia(m); write(DRAFT_KEY, { text, span, custom, media: m }); }, (i, f) => setUp({ i, f }));
      }
    } catch (e) {
      setBusy(false); setUp(null);
      const m = e instanceof Error ? e.message : "";
      setErr(m === "offline" ? tr("You're offline. Your letter is kept here as a draft: seal it when you're back online.")
        : m === "missing" ? tr("One photo or video isn't on this phone any more. Remove it and add it again.")
        : m === "unreachable" || m === "script" ? tr("Your Apps Script didn't take the file. Paste the newest Code.gs and publish a new version (Déployer → Gérer les déploiements → ✏️ → Nouvelle version).")
        : tr("The upload stopped. Tap Seal again: it carries on where it stopped."));
      return;
    }
    setUp(null);
    const r = await postToSheet(sheet.url, { future: { id: newId(), written: today, due, text: text.trim(), lang: getLang(), name: prefs.name, hijri: hijri(today), snap, media: asSheetMedia(sent) } }, true);
    setBusy(false);
    if (r.ok && r.future) {
      // Sealed: the photos and videos leave this phone too, so nothing of the letter stays readable here.
      sent.forEach((m) => { void deletePhoto(m.id); if (m.kind === "video") void deletePhoto(posterId(m.id)); });
      setMedia([]);
      write(DRAFT_KEY, null);
      setText("");
      haptic([20, 40, 60]);
      onSealed(r.future);
    } else setErr(r.error === "offline" ? tr("You're offline. Your letter is kept here as a draft: seal it when you're back online.") : r.error === "unreachable" ? tr("Couldn't reach your sheet. If you just updated the script, publish a new version (Déployer → Gérer les déploiements → ✏️ → Nouvelle version).") : r.error || tr("Couldn't seal it. Try again."));
  };

  return (
    <BottomSheet open={open} onClose={onClose} label={tr("Letter to future me")}>
      <div className="sheet-body fm-compose">
        <h3>{tr("Dear me, {s} from now", { s: spanText(today, due) })}</h3>
        <div className="lab">{tr("When should it arrive?")}</div>
        <div className="whychips">
          {SPANS.map((s) => (
            <motion.button key={s.m} {...tap} className={`whychip ${span === s.m ? "on" : ""}`} onClick={() => { setSpan(s.m); haptic(5); }}>{tr(s.label)}</motion.button>
          ))}
          <motion.button {...tap} className={`whychip ${span === "date" ? "on" : ""}`} onClick={() => { setSpan("date"); haptic(5); }}>{tr("Pick a date")}</motion.button>
        </div>
        <AnimatePresence initial={false}>
          {span === "date" && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden" }}>
              <input type="date" className="inp big" value={custom} min={minDate} max={maxDate} onChange={(e) => setCustom(e.target.value)} aria-label={tr("Delivery date")} />
            </motion.div>
          )}
        </AnimatePresence>
        <p className="note fm-when">📅 {tr("Arrives {d}", { d: longDate(due) })}{due > maxDate ? ` · ${tr("3 years at most")}` : due < minDate ? ` · ${tr("at least a month away")}` : ""}</p>
        <div className="fm-paper">
          <textarea ref={ref} className="fm-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={tr("Who you are today, what you're working on, what you hope for, what you're afraid of… Write it to the person reading it later.")} />
        </div>
        <div className="fm-media">
          {media.map((m) => <FmThumb key={m.id} m={m} onRemove={busy ? undefined : () => removeMedia(m)} />)}
          {media.length < 4 && <PhotoButtons date={today} count={media.length} disabled={busy} onAdd={(refs) => setMedia((xs) => [...xs, ...refs].slice(0, 4))} />}
        </div>
        {!text && (
          <div className="row">
            {STARTERS.map((s) => <motion.button key={s} className="pill prompt" {...tap} onClick={() => { setText(tr(s).replace(/…$/, " ")); ref.current?.focus(); }}>{tr(s)}</motion.button>)}
          </div>
        )}
        <p className="note num">{tr("{n} words", { n: words(text) })} · {tr("Once sealed, you can't read or change it until it arrives.")}</p>
        {err && <p className="note warnnote">⚠ {err}</p>}
        <div className="sheet-foot">
          <motion.button className="btn big fm-seal" {...tap} disabled={!valid || busy} onClick={(e) => { burst(e.clientX, e.clientY); void seal(); }}>
            {busy ? <span className="spinner" aria-hidden="true" /> : "🔒 "}
            {up ? tr("Uploading {i} of {n} · {p}%", { i: up.i + 1, n: media.length, p: Math.round(up.f * 100) }) : tr(busy ? "Sealing…" : "Seal the letter")}
          </motion.button>
        </div>
      </div>
    </BottomSheet>
  );
}

function FmThumb({ m, onRemove }: { m: PhotoRef; onRemove?: () => void }) {
  const url = usePhotoUrl(m.kind === "video" ? posterId(m.id) : m.id);
  const done = m.kind === "video" ? !!(m.drive && m.poster) : !!m.drive;
  return (
    <motion.div className="fm-thumb" layout initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
      {url ? <img src={url} alt="" draggable={false} /> : <span>{m.kind === "video" ? "🎬" : "📷"}</span>}
      {m.kind === "video" && m.dur ? <small className="num">{fmtDur(m.dur)}</small> : null}
      {done && <i aria-label={tr("Uploaded")}>✓</i>}
      {onRemove && <button type="button" onClick={onRemove} aria-label={tr("Remove")}>×</button>}
    </motion.div>
  );
}

/** Full-screen moment: the letter folds into its envelope and the wax seal stamps down. */
function SealMoment({ onDone }: { onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 2600); return () => clearTimeout(t); }, [onDone]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <motion.div className="fm-moment" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onDone}>
      <div className="fm-stage">
        <motion.div className="fm-sheet" initial={{ y: -70, scaleY: 1 }} animate={{ y: [-70, -70, 10], scaleY: [1, 1, 0.35], opacity: [1, 1, 0] }} transition={{ duration: 1.1, times: [0, 0.35, 1] }} />
        <svg viewBox="0 0 120 90" className="fm-big" aria-hidden="true">
          <rect x="6" y="14" width="108" height="68" rx="9" className="e-body" />
          <motion.path d="M6 22 L60 56 L114 22" className="e-flap" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.9, duration: 0.45 }} />
          <motion.circle cx="60" cy="56" r="12" className="e-seal" initial={{ scale: 2.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 1.35, type: "spring", stiffness: 420, damping: 16 }} style={{ transformOrigin: "60px 56px" }} />
        </svg>
        <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.6 }}>{tr("Sealed. See you then, in shāʾ Allāh.")}</motion.p>
      </div>
    </motion.div>,
    document.body,
  );
}
