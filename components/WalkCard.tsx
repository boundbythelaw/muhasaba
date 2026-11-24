"use client";
import { num, tr } from "@/lib/i18n";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { STEP_GOAL } from "@/lib/constants";
import { burst, haptic, toast } from "@/lib/fx";
import { useStore } from "@/lib/store";
import { StepsSheet } from "./Sheets";
import { AnimatedNumber, CardShell, Pill } from "./ui";

export default function WalkCard() {
  const { day, scores, update, locked, requestUnlock, cur } = useStore();
  const v2 = (day.v ?? 1) >= 2;
  const [editing, setEditing] = useState(false);
  const st = day.steps ?? 0;
  const pct = Math.min(st / STEP_GOAL, 1);
  const over = Math.max(0, st - STEP_GOAL);
  const msg = st >= STEP_GOAL ? (over ? tr("{n} past your minimum", { n: num(over) }) : tr("Minimum met")) : st ? tr("{n} to go", { n: num(STEP_GOAL - st) }) : tr("Tap to log your steps");

  const save = async (n: number | null, pt?: { clientX: number; clientY: number }) => {
    const before = day.steps ?? 0;
    // Steps go up through the day, so changing them never asks "Change what you logged?". (That question
    // also used to be dismissed instantly when it opened as the steps popup closed, so Save did nothing.)
    const ok = await update((d) => { d.steps = n && n > 0 ? Math.min(100000, n) : null; }, pt ?? null, false, { noConfirm: true });
    if (ok && before < STEP_GOAL && (n ?? 0) >= STEP_GOAL) {
      const r = document.getElementById("steps-meter")?.getBoundingClientRect();
      burst(r ? r.right - 20 : innerWidth / 2, r ? r.top + 10 : innerHeight / 2);
      haptic(25);
      toast(tr("8,000 reached. Minimum met."));
    }
  };

  return (
    <CardShell id="sec-s" title={tr("Health")} ar="الصحة" value={scores.s} max={10} done={scores.s >= 10}
      summary={`${tr("{n} steps", { n: num(st) })}${day.workout.done ? " · " + tr("workout ✓") : ""}`}>
      {v2 && <p className="sub">{tr("Steps 5 (8,000) + home workout 5.")}</p>}
      <motion.button className="stepscard" onClick={() => (locked ? requestUnlock(cur) : setEditing(true))} whileTap={{ scale: 0.98 }} aria-label={tr("Edit steps")}>
        <div className="stepsbig">
          <b className="num"><AnimatedNumber value={st} /></b>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={msg.includes("past") ? "past" : msg} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>{msg}</motion.span>
          </AnimatePresence>
        </div>
        <div className="stepmeter" id="steps-meter">
          <motion.div className={st >= STEP_GOAL ? "full" : ""} initial={false} animate={{ width: `${pct * 100}%` }} transition={{ type: "spring", stiffness: 140, damping: 20 }} />
          {Array.from({ length: 8 }, (_, i) => <i key={i} style={{ left: `${((i + 1) / 8) * 100}%` }} />)}
        </div>
        <span className="editlink">{tr("✎ Edit steps")}</span>
      </motion.button>
      <div className="row">
        {[4000, 6000, 8000, 10000, 12000].map((n) => (
          <Pill key={n} on={day.steps === n} onClick={(e) => save(day.steps === n ? null : n, e)}>{n / 1000}k</Pill>
        ))}
      </div>
      {v2 ? <WorkoutPanel /> : <p className="note">{tr("The workout wasn't in the app yet on this day, so steps count for all 10.")}</p>}
      <StepsSheet open={editing} onClose={() => setEditing(false)} value={day.steps} onSave={(n) => save(n)} />
    </CardShell>
  );
}

const KINDS = ["Push-ups", "Squats", "Core / abs", "Pull-ups", "Lunges", "Cardio", "Stretching"];

/** Home workout: one big tap for done (+5), then optional minutes and what you trained. */
function WorkoutPanel() {
  const { day, update } = useStore();
  const w = day.workout;
  const toggle = (e: React.MouseEvent) => update((d) => { d.workout.done = !d.workout.done; }, e).then((ok) => {
    if (ok && !w.done) { burst(e.clientX, e.clientY); haptic(25); toast(tr("Workout done. Your body has a right over you.")); }
  });
  return (
    <div className="workout">
      <motion.button className={`wo-main ${w.done ? "on" : ""}`} whileTap={{ scale: 0.96 }} onClick={toggle}>
        <motion.span className="wo-ico" animate={w.done ? { rotate: [0, -12, 12, 0], scale: [1, 1.25, 1] } : {}} transition={{ duration: 0.5 }}>💪</motion.span>
        <span className="wo-txt"><b>{w.done ? tr("Workout done") : tr("Home workout")}</b><small>{w.done ? tr("tap to undo") : tr("tap when you've trained")}</small></span>
        <em className="num">{w.done ? "5/5" : "+5"}</em>
      </motion.button>
      <AnimatePresence initial={false}>
        {w.done && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden" }}>
            <div className="row">
              {[10, 20, 30, 45, 60].map((m) => (
                <Pill key={m} on={w.minutes === m} onClick={(e) => update((d) => { d.workout.minutes = d.workout.minutes === m ? null : m; }, e, true, { noConfirm: true })}>{m} min</Pill>
              ))}
            </div>
            <div className="row">
              {KINDS.map((k) => (
                <Pill key={k} on={w.kinds.includes(k)} onClick={(e) => update((d) => { d.workout.kinds = d.workout.kinds.includes(k) ? d.workout.kinds.filter((x) => x !== k) : [...d.workout.kinds, k]; }, e, true, { noConfirm: true })}>{tr(k)}</Pill>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
