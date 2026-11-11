"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { addDays, todayKey } from "@/lib/dates";
import { haptic, toast } from "@/lib/fx";
import { tr } from "@/lib/i18n";
import { checkinDone, sleepHours } from "@/lib/scoring";
import { useStore } from "@/lib/store";
import type { Checkin } from "@/lib/types";
import { BottomSheet } from "./Sheets";
import { CardShell, Segmented, tap } from "./ui";

const ENERGY = ["😫", "😕", "😐", "🙂", "💪"];
const MOOD = ["😞", "🙁", "😐", "🙂", "😄"];

export const filledCount = (c: Checkin) => [c.slept && c.woke, c.phone != null, c.energy, c.mood].filter(Boolean).length;

function Faces({ value, faces, label, onPick }: { value: number | null; faces: string[]; label: string; onPick: (n: number) => void }) {
  return (
    <div className="faces" role="radiogroup" aria-label={label}>
      {faces.map((f, i) => (
        <motion.button key={i} role="radio" aria-checked={value === i + 1} aria-label={`${label} ${i + 1}/5`} className={value === i + 1 ? "on" : ""}
          {...tap} onClick={() => { onPick(i + 1); haptic(6); }}>
          <span>{f}</span><small>{i + 1}</small>
        </motion.button>
      ))}
    </div>
  );
}

/** Time typed in a box is only saved when you leave it, so the change popup never interrupts typing. */
function TimeBox({ value, label, onCommit }: { value: string | null; label: string; onCommit: (v: string | null) => void }) {
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  return (
    <label className="timebox">
      <span>{label}</span>
      <input className="inp num" type="time" value={v} onChange={(e) => setV(e.target.value)}
        onBlur={() => { const n = v || null; if (n !== value) onCommit(n); }} />
    </label>
  );
}

/**
 * The evening check-in: last night's sleep, phone use, energy, mood, and a private "I slipped" with tawbah.
 * Required every day: it's what lets the Insights tab find what makes good and bad days.
 */
export default function CheckinCard() {
  const { day, update, locked, requestUnlock, cur } = useStore();
  const c = day.checkin;
  const n = filledCount(c);
  const done = checkinDone(c);
  const hrs = sleepHours(c);
  const set = (fn: (c: Checkin) => void) => {
    if (locked) { requestUnlock(cur); return; }
    void update((d) => { fn(d.checkin); }, null, true);
  };
  // A small thank-you the moment it becomes complete.
  const prev = useRef(done);
  useEffect(() => {
    if (done && !prev.current) toast(tr("Check-in done. Jazāk Allāhu khayran."));
    prev.current = done;
  }, [done]);

  return (
    <CardShell id="sec-c" title="Check-in" ar="المحاسبة" value={n} max={4} done={done}
      summary={tr("Slept {h} h · energy {e}/5 · mood {m}/5", { h: hrs ?? "?", e: c.energy ?? "?", m: c.mood ?? "?" })}
      className={done ? "" : "required"}>
      <p className="sub">{tr("Required each evening. It's how the Insights find what makes your good and bad days. Not scored.")}</p>

      <div className="lab">{tr("Last night's sleep")}</div>
      <div className="sleeprow">
        <TimeBox label={tr("Slept at")} value={c.slept} onCommit={(v) => set((x) => { x.slept = v; })} />
        <TimeBox label={tr("Woke at")} value={c.woke} onCommit={(v) => set((x) => { x.woke = v; })} />
        <div className={`sleeph num ${hrs != null && hrs < 6 ? "low" : ""}`}>{hrs != null ? `${hrs} h` : "– h"}</div>
      </div>

      <div className="lab">{tr("Phone & scrolling today")}</div>
      <Segmented ariaLabel={tr("Phone & scrolling today")} value={c.phone ?? undefined}
        options={[{ value: 0, label: "None", sub: tr("only needed"), tone: "top" }, { value: 1, label: "A bit", sub: "< 1 h" }, { value: 2, label: "A lot", sub: "1 h +", tone: "bad" }]}
        onSelect={(v) => { haptic(6); set((x) => { x.phone = x.phone === v ? null : (v as 0 | 1 | 2); }); }} />

      <div className="lab">{tr("Energy")}</div>
      <Faces value={c.energy} faces={ENERGY} label={tr("Energy")} onPick={(v) => set((x) => { x.energy = x.energy === v ? null : v; })} />
      <div className="lab">{tr("Mood")}</div>
      <Faces value={c.mood} faces={MOOD} label={tr("Mood")} onPick={(v) => set((x) => { x.mood = x.mood === v ? null : v; })} />

      <div className="lab">{tr("Between you and Allah")}</div>
      <motion.button className={`struggle ${c.slip ? "on" : ""}`} {...tap}
        onClick={() => { haptic(8); set((x) => { x.slip = !x.slip; if (!x.slip) x.tawbah = false; }); }}>
        <i>{c.slip ? "●" : ""}</i>
        <span><b>{tr("I slipped today")}</b><small>{tr("Private. No details, just a mark for the patterns.")}</small></span>
      </motion.button>
      <AnimatePresence initial={false}>
        {c.slip && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden" }}>
            <motion.button className={`struggle tawbah ${c.tawbah ? "on" : ""}`} {...tap}
              onClick={() => { haptic(10); set((x) => { x.tawbah = !x.tawbah; }); }}>
              <i>{c.tawbah ? "✓" : ""}</i>
              <span><b>{tr("I made tawbah")}</b><small>{tr("“Allah loves those who turn back to Him.” (2:222)")}</small></span>
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </CardShell>
  );
}

/**
 * Opening the app with yesterday's check-in unfinished shows a one-tap reminder (once per day).
 */
export function CheckinNudge() {
  const { days, hydrated, goTo, setView } = useStore();
  const [open, setOpen] = useState(false);
  const y = addDays(todayKey(), -1);
  useEffect(() => {
    if (!hydrated) return;
    const d = days[y];
    // Only for days that were actually used, so an empty day before installing doesn't nag.
    const used = d && (Object.keys(d.prayers).length || d.quran.mem || d.journal.length || d.steps);
    if (!used || checkinDone(d.checkin)) return;
    const key = "muhasaba-nudge-" + y;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch { /* ignore */ }
    const t = setTimeout(() => setOpen(true), 900);
    return () => clearTimeout(t);
  }, [hydrated, days, y]);
  const go = () => {
    setOpen(false);
    goTo(y);
    setView("today");
    setTimeout(() => document.getElementById("sec-c")?.scrollIntoView({ behavior: "smooth", block: "start" }), 500);
  };
  return (
    <BottomSheet open={open} onClose={() => setOpen(false)} label="Check-in">
      <div className="sheet-body">
        <h3>{tr("Yesterday's check-in isn't done")}</h3>
        <p className="sheet-msg">{tr("Sleep, phone, energy and mood take 10 seconds, and they're what your Insights are built on.")}</p>
        <motion.button className="btn big" {...tap} onClick={go}>{tr("Fill it now")}</motion.button>
        <motion.button className="btn ghost big" {...tap} onClick={() => setOpen(false)}>{tr("Later")}</motion.button>
      </div>
    </BottomSheet>
  );
}
