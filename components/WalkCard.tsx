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
  const [editing, setEditing] = useState(false);
  const st = day.steps ?? 0;
  const pct = Math.min(st / STEP_GOAL, 1);
  const over = Math.max(0, st - STEP_GOAL);
  const msg = st >= STEP_GOAL ? (over ? tr("{n} past your minimum", { n: num(over) }) : tr("Minimum met")) : st ? tr("{n} to go", { n: num(STEP_GOAL - st) }) : tr("Tap to log your steps");

  const save = async (n: number | null, pt?: { clientX: number; clientY: number }) => {
    const before = day.steps ?? 0;
    const ok = await update((d) => { d.steps = n && n > 0 ? Math.min(100000, n) : null; }, pt ?? null);
    if (ok && before < STEP_GOAL && (n ?? 0) >= STEP_GOAL) {
      const r = document.getElementById("steps-meter")?.getBoundingClientRect();
      burst(r ? r.right - 20 : innerWidth / 2, r ? r.top + 10 : innerHeight / 2);
      haptic(25);
      toast(tr("8,000 reached. Minimum met."));
    }
  };

  return (
    <CardShell id="sec-s" title={tr("Daily walk")} value={scores.s} max={10} done={scores.s >= 10} summary={tr("{n} steps", { n: num(st) })}>
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
      <StepsSheet open={editing} onClose={() => setEditing(false)} value={day.steps} onSave={(n) => save(n)} />
    </CardShell>
  );
}
