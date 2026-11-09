"use client";
import { getName, tr } from "@/lib/i18n";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { THEME_KEY } from "@/lib/constants";
import { addDays, shortDate, todayKey } from "@/lib/dates";
import { haptic, subscribeFx, toast, type FloatEvt } from "@/lib/fx";
import { fmt, grade, scoreDay } from "@/lib/scoring";
import { useStore, type View } from "@/lib/store";
import { tap } from "./ui";
import { statusLine } from "./SheetCard";

/* ---------- Header with theme switch ---------- */
type Theme = "auto" | "light" | "dark";
const THEME_NAME: Record<Theme, string> = { auto: "Theme follows your phone", light: "Fajr theme", dark: "Isha theme" };

function ThemeIcon({ theme }: { theme: Theme }) {
  if (theme === "light") return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
  if (theme === "dark") return <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" /></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" /></svg>;
}

export function Header() {
  const [theme, setTheme] = useState<Theme>("auto");
  useEffect(() => {
    try { const t = localStorage.getItem(THEME_KEY); if (t === "light" || t === "dark") setTheme(t); } catch { /* ignore */ }
  }, []);
  const cycle = () => {
    const next: Theme = theme === "auto" ? "light" : theme === "light" ? "dark" : "auto";
    setTheme(next);
    const r = document.documentElement;
    if (next === "auto") delete r.dataset.theme; else r.dataset.theme = next;
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    haptic(8);
    toast(tr(THEME_NAME[next]));
  };
  return (
    <header className="top">
      <div className="brand">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="" />
        <div>Muhasaba{getName() && <small>{getName()}</small>}</div>
      </div>
      <div className="tright">
      <StreakFlame />
      <SyncChip />
      <motion.button className="iconbtn" onClick={cycle} aria-label={tr(THEME_NAME[theme])} {...tap}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={theme} initial={{ rotate: -90, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 90, opacity: 0 }} transition={{ duration: 0.2 }} style={{ display: "grid" }}>
            <ThemeIcon theme={theme} />
          </motion.span>
        </AnimatePresence>
      </motion.button>
      </div>
    </header>
  );
}

/* ---------- Sheet sync chip ---------- */
function SyncChip() {
  const { sheet, syncStatus, setView } = useStore();
  if (!sheet.url) return null;
  const waiting = Object.keys(sheet.pending).length;
  const tone = syncStatus === "error" ? "err" : syncStatus === "offline" ? "off" : waiting || syncStatus === "syncing" ? "busy" : "ok";
  const open = () => {
    setView("record");
    haptic(6);
    setTimeout(() => document.getElementById("sheet-card")?.scrollIntoView({ behavior: "smooth", block: "center" }), 380);
  };
  return (
    <motion.button className={`syncchip ${tone}`} onClick={open} aria-label={statusLine(syncStatus, waiting, sheet.lastSync)} {...tap} layout>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="3" width="16" height="18" rx="2.5" /><path d="M4 9h16M4 15h16M10 3v18" />
      </svg>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={tone + waiting} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}>
          {tone === "ok" ? "✓" : tone === "err" ? "!" : waiting || "…"}
        </motion.span>
      </AnimatePresence>
      {tone === "busy" && <motion.i className="spin" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }} />}
    </motion.button>
  );
}

/* ---------- Tabs with a sliding pill ---------- */
export function Tabs() {
  const { view, setView } = useStore();
  const tabs: [View, string][] = [["today", "Log the day"], ["journal", "Journal"], ["record", "Record"]];
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([v, label]) => (
        <motion.button key={v} role="tab" aria-selected={view === v} onClick={() => { if (view !== v) { setView(v); haptic(6); } }} whileTap={{ scale: 0.97 }}>
          {view === v && <motion.span layoutId="tab-pill" className="pill-bg" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
          <span>{tr(label)}</span>
        </motion.button>
      ))}
    </div>
  );
}

/* ---------- App-style bottom navigation ---------- */
const NAV: { v: View; label: string; icon: React.ReactNode }[] = [
  { v: "today", label: "Today", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3 8-8" /><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" /></svg> },
  { v: "journal", label: "Journal", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg> },
  { v: "record", label: "Record", icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2" /></svg> },
];
export function BottomNav() {
  const { view, setView, day } = useStore();
  return (
    <nav className="bottomnav" aria-label={tr("Sections")}>
      {NAV.map(({ v, label, icon }) => {
        const on = view === v;
        return (
          <motion.button key={v} className={on ? "on" : ""} aria-current={on ? "page" : undefined} whileTap={{ scale: 0.88 }}
            onClick={() => { if (!on) { setView(v); haptic(8); window.scrollTo({ top: 0, behavior: "smooth" }); } }}>
            {on && <motion.span layoutId="nav-pill" className="nav-pill" transition={{ type: "spring", stiffness: 480, damping: 34 }} />}
            <motion.span className="nav-ico" animate={on ? { y: [0, -4, 0], scale: [1, 1.15, 1] } : { y: 0, scale: 1 }} transition={{ duration: 0.35 }}>{icon}</motion.span>
            <span className="nav-lbl">{tr(label)}</span>
            {v === "journal" && day.journal.length > 0 && <span className="nav-dot num">{day.journal.length}</span>}
          </motion.button>
        );
      })}
    </nav>
  );
}

/* ---------- Streak flame ---------- */
function StreakFlame() {
  const { days, setView } = useStore();
  const t = todayKey();
  let k = days[t] && scoreDay(days[t]).total >= 70 ? t : addDays(t, -1), n = 0;
  while (days[k] && scoreDay(days[k]).total >= 70) { n++; k = addDays(k, -1); }
  if (!n) return null;
  return (
    <motion.button className="flame" onClick={() => { setView("record"); haptic(6); toast(tr(n > 1 ? "{n} days in a row at 70+. Keep the chain." : "1 day at 70+. Keep the chain going.", { n })); }}
      initial={{ scale: 0 }} animate={{ scale: 1 }} whileTap={{ scale: 0.9 }} aria-label={tr("{n} day streak", { n })}>
      <motion.span animate={{ rotate: [-6, 6, -4, 4, -6], scale: [1, 1.08, 0.96, 1.05, 1] }} transition={{ repeat: Infinity, duration: 1.6 }}>🔥</motion.span>
      <b className="num">{n}</b>
    </motion.button>
  );
}

/* ---------- Floating points + toasts ---------- */
export function FxLayer() {
  const [floats, setFloats] = useState<FloatEvt[]>([]);
  const [msg, setMsg] = useState<{ id: number; text: string } | null>(null);
  useEffect(() => {
    let tmo: ReturnType<typeof setTimeout>;
    const off = subscribeFx({
      onFloat: (f) => {
        setFloats((x) => [...x, f]);
        setTimeout(() => setFloats((x) => x.filter((y) => y.id !== f.id)), 950);
      },
      onToast: (text) => {
        setMsg({ id: Date.now(), text });
        clearTimeout(tmo);
        tmo = setTimeout(() => setMsg(null), 2400);
      },
    });
    return () => { off(); clearTimeout(tmo); };
  }, []);
  return (
    <>
      <AnimatePresence>
        {floats.map((f) => (
          <motion.div key={f.id} className={`float ${f.value < 0 ? "neg" : ""}`} style={{ left: f.x, top: f.y - 10 }}
            initial={{ opacity: 1, y: 0, scale: 0.7 }} animate={{ opacity: [1, 1, 0], y: -60, scale: [0.7, 1.2, 1] }} transition={{ duration: 0.9, ease: "easeOut" }}>
            {f.value > 0 ? "+" : ""}{fmt(f.value)}
          </motion.div>
        ))}
      </AnimatePresence>
      <AnimatePresence>
        {msg && (
          <motion.div key={msg.id} className="toast" role="status" initial={{ opacity: 0, y: 30, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}>
            {msg.text}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ---------- Mini score that drops in once the hero scrolls away ---------- */
export function MiniScore() {
  const { cur, scores } = useStore();
  const [show, setShow] = useState(false);
  useEffect(() => {
    const hero = document.getElementById("hero");
    if (!hero) return;
    const io = new IntersectionObserver(([en]) => setShow(!en.isIntersecting && en.boundingClientRect.top < 0));
    io.observe(hero);
    return () => io.disconnect();
  }, []);
  return (
    <AnimatePresence>
      {show && (
        <motion.button className="mini" aria-label={tr("Back to top")} onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          initial={{ y: -80 }} animate={{ y: 0 }} exit={{ y: -80 }} transition={{ type: "spring", stiffness: 380, damping: 30 }}>
          <b className="num">{Math.round(scores.total)}</b>
          <span>{cur === todayKey() ? tr("Today") : shortDate(cur)} · {grade(scores.total)}</span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
