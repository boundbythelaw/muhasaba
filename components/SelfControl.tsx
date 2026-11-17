"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, parseKey, todayKey } from "@/lib/dates";
import { burst, haptic, toast } from "@/lib/fx";
import { tr } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import type { DayLog } from "@/lib/types";
import { BottomSheet } from "./Sheets";
import { CardShell, tap } from "./ui";

/** Ramadan 1448 is expected to begin around 8 February 2027 (depends on the moon sighting). */
export const RAMADAN = "2027-02-08";
const MILESTONES = [3, 7, 14, 30, 66];
const TRIGGERS = ["Phone at night", "Alone", "Bored", "Tired", "Stressed", "In bed", "Social media", "After a hard day"];
const SURF_SECONDS = 180;

const between = (a: string, b: string) => Math.round((parseKey(b).getTime() - parseKey(a).getTime()) / 864e5);

/** Clean-day streak, best streak and urge totals from the days. Private: nothing here names the habit. */
export function selfControl(days: Record<string, DayLog>, start: string | undefined, today: string) {
  if (!start) return null;
  const relapses = Object.keys(days).filter((k) => k >= start && k <= today && days[k].sc?.relapse).sort();
  const from = relapses.length ? addDays(relapses[relapses.length - 1], 1) : start;
  const streak = Math.max(0, between(from, today)); // full days done; today is day streak + 1
  let best = 0, s = start;
  for (const r of relapses) { best = Math.max(best, between(s, r)); s = addDays(r, 1); }
  best = Math.max(best, streak);
  const urges = Object.keys(days).filter((k) => k >= start).flatMap((k) => days[k].sc?.urges ?? []);
  const week = Object.keys(days).filter((k) => k > addDays(today, -7) && k <= today).flatMap((k) => days[k].sc?.urges ?? []);
  return { streak, best, relapses: relapses.length, urges: urges.length, resisted: urges.filter((u) => u.ok).length, weekResisted: week.filter((u) => u.ok).length, toRamadan: between(today, RAMADAN) };
}

/**
 * Self-control: a private streak toward Ramadan, with help in the moment of an urge.
 * Research-based: urges rise and fall within minutes (urge surfing, ACT), habits take ~66 days to settle,
 * and a single slip doesn't erase progress. So: no "allowed days", and no shame after a slip.
 */
export default function SelfControlCard() {
  const { days, prefs, setPrefs, cur } = useStore();
  const today = todayKey();
  const st = useMemo(() => selfControl(days, prefs.scStart, today), [days, prefs.scStart, today]);
  const [urge, setUrge] = useState(false);
  const [slip, setSlip] = useState(false);
  if (cur !== today) return null;

  if (!st) {
    return (
      <CardShell id="sec-x" title={tr("Self-control")} ar="مجاهدة" value={0} max={0} done={false} summary="" pending={tr("Not started")} badge={<span className="badge">🛡️</span>}>
        <p className="sub">{tr("A private streak toward Ramadan, with help in the moment an urge comes. Nothing here names the habit.")}</p>
        <motion.button className="btn big" {...tap} onClick={() => { setPrefs({ scStart: today }); haptic(20); toast(tr("Bismillāh. Day 1 starts now.")); }}>{tr("Start my streak today")}</motion.button>
      </CardShell>
    );
  }
  const day = st.streak + 1;
  const nextM = MILESTONES.find((m) => m > st.streak) ?? null;
  const ringPct = nextM ? st.streak / nextM : 1;
  return (
    <CardShell id="sec-x" title={tr("Self-control")} ar="مجاهدة" value={st.streak} max={0} done={false}
      summary="" pending={tr("Day {d} · best {b}", { d: day, b: st.best })}
      badge={<motion.span className="badge num" key={st.streak} initial={{ scale: 0.8 }} animate={{ scale: 1 }}>🛡️ {st.streak}</motion.span>}>
      <div className="sc-top">
        <div className="sc-ring">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle cx="60" cy="60" r="52" className="sc-bg" />
            <motion.circle cx="60" cy="60" r="52" className="sc-fg" initial={{ pathLength: 0 }} animate={{ pathLength: ringPct }} transition={{ type: "spring", stiffness: 60, damping: 18 }} style={{ rotate: -90, transformOrigin: "50% 50%" }} />
          </svg>
          <div className="sc-num"><b className="num">{st.streak}</b><small>{st.streak === 1 ? tr("clean day") : tr("clean days")}</small></div>
        </div>
        <div className="sc-side">
          <div><b className="num">{st.best}</b><span>{tr("best streak")}</span></div>
          <div><b className="num">{st.weekResisted}</b><span>{tr("urges beaten this week")}</span></div>
          <div><b className="num">{Math.max(0, st.toRamadan)}</b><span>{tr("days to Ramadan")}</span></div>
        </div>
      </div>
      <div className="sc-miles">
        {[...MILESTONES, "R" as const].map((m) => {
          const reached = m === "R" ? st.toRamadan <= 0 && st.streak > 0 : st.streak >= m;
          return (
            <motion.span key={m} className={`sc-m ${reached ? "on" : ""} ${m === nextM ? "next" : ""}`} animate={reached ? { scale: [1, 1.15, 1] } : {}}>
              {m === "R" ? "🌙" : m}
            </motion.span>
          );
        })}
      </div>
      <p className="note">{nextM ? tr("{n} days to your next milestone ({m}). Habits take about 66 days to settle.", { n: nextM - st.streak, m: nextM }) : tr("Past 66 days: the habit has lost its grip. Keep guarding it until Ramadan and beyond.")}</p>
      <motion.button className="sc-urge" whileTap={{ scale: 0.97 }} onClick={() => { setUrge(true); haptic(15); }}>
        <span>🛡️</span><b>{tr("I'm having an urge")}</b><small>{tr("3 minutes. It will pass.")}</small>
      </motion.button>
      <button className="linkbtn sc-sliplink" onClick={() => setSlip(true)}>{tr("I slipped")}</button>
      <UrgeSheet open={urge} onClose={() => setUrge(false)} onSlip={() => { setUrge(false); setSlip(true); }} />
      <SlipSheet open={slip} onClose={() => setSlip(false)} />
    </CardShell>
  );
}

function UrgeSheet({ open, onClose, onSlip }: { open: boolean; onClose: () => void; onSlip: () => void }) {
  const { update } = useStore();
  const [trig, setTrig] = useState<string[]>([]);
  const [left, setLeft] = useState(SURF_SECONDS);
  const [dhikr, setDhikr] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!open) { if (timer.current) clearInterval(timer.current); return; }
    setTrig([]); setLeft(SURF_SECONDS); setDhikr(0);
    timer.current = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [open]);
  const log = (ok: boolean) => {
    const t = new Date();
    const hm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
    return update((d) => { d.sc.urges.push({ t: hm, trig, ok }); if (!ok) d.sc.relapse = true; }, null, true, { noConfirm: true });
  };
  const breath = (SURF_SECONDS - left) % 10 < 4 ? "in" : (SURF_SECONDS - left) % 10 < 6 ? "hold" : "out";
  return (
    <BottomSheet open={open} onClose={onClose} label={tr("Urge")}>
      <div className="sheet-body urge">
        <h3>{tr("Ride it out. It peaks, then it passes.")}</h3>
        <div className="breath">
          <motion.div className="breath-c" animate={{ scale: breath === "in" ? 1.35 : breath === "hold" ? 1.35 : 0.85 }} transition={{ duration: breath === "out" ? 4 : 4, ease: "easeInOut" }} />
          <div className="breath-t"><b className="num">{Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}</b><small>{tr(breath === "in" ? "breathe in" : breath === "hold" ? "hold" : "breathe out")}</small></div>
        </div>
        <div className="urge-acts">
          <span>💧 {tr("Make wuḍūʾ")}</span><span>🚪 {tr("Leave the room")}</span><span>📵 {tr("Phone away")}</span><span>🚶 {tr("Walk / push-ups")}</span>
        </div>
        <motion.button className="dhikr" whileTap={{ scale: 0.92 }} onClick={() => { setDhikr((n) => n + 1); haptic(8); }}>
          <span className="ar">أستغفر الله</span><b className="num">{dhikr}</b>
        </motion.button>
        <div className="lab">{tr("What set it off?")}</div>
        <div className="whychips">
          {TRIGGERS.map((x) => <motion.button key={x} {...tap} className={`whychip ${trig.includes(x) ? "on" : ""}`} onClick={() => setTrig((a) => (a.includes(x) ? a.filter((y) => y !== x) : [...a, x]))}>{tr(x)}</motion.button>)}
        </div>
        <motion.button className="btn big" {...tap} onClick={(e) => { void log(true).then(() => { burst(e.clientX, e.clientY); haptic(30); toast(tr("You beat it. That's real strength, by Allah's help.")); onClose(); }); }}>
          {tr("It passed ✓")}
        </motion.button>
        <motion.button className="btn ghost" {...tap} onClick={() => { void log(false).then(onSlip); }}>{tr("I didn't make it")}</motion.button>
      </div>
    </BottomSheet>
  );
}

function SlipSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { day, update } = useStore();
  return (
    <BottomSheet open={open} onClose={onClose} label={tr("Slip")}>
      <div className="sheet-body">
        <h3>{tr("It happened. It doesn't erase what you built.")}</h3>
        <p className="sheet-msg">{tr("One slip doesn't undo a habit you're building. Make tawbah, note what set it off, and start the next streak now. Your best streak stays.")}</p>
        {!day.sc.relapse ? (
          <motion.button className="btn big" {...tap} onClick={() => { void update((d) => { d.sc.relapse = true; d.checkin.slip = true; }, null, true, { noConfirm: true }).then(onClose); }}>
            {tr("Mark today and restart")}
          </motion.button>
        ) : (
          <motion.button className="btn ghost big" {...tap} onClick={() => { void update((d) => { d.sc.relapse = false; }, null, true).then(onClose); }}>
            {tr("Undo: I didn't slip today")}
          </motion.button>
        )}
        <motion.button className="btn ghost big" {...tap} onClick={onClose}>{tr("Close")}</motion.button>
      </div>
    </BottomSheet>
  );
}
