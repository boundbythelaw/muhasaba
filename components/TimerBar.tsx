"use client";
import { tr } from "@/lib/i18n";
import { AnimatePresence, motion } from "framer-motion";
import { clock } from "@/lib/dates";
import { useNow } from "@/lib/store";
import { tap } from "./ui";

export default function TimerBar({ start, idleText, runText, startLabel, stopLabel, onStart, onStop }: {
  start: number | null; idleText: string; runText: string; startLabel: string; stopLabel: string;
  onStart: () => void; onStop: (e: React.MouseEvent) => void;
}) {
  const running = start != null;
  const now = useNow(running);
  return (
    <motion.div className={`timer ${running ? "run" : ""}`} layout transition={{ type: "spring", stiffness: 400, damping: 34 }}>
      <div className="clock num">
        <AnimatePresence>{running && <motion.span className="dot" initial={{ scale: 0 }} animate={{ scale: 1, opacity: [1, 0.25, 1] }} exit={{ scale: 0 }} transition={{ opacity: { repeat: Infinity, duration: 1 } }} />}</AnimatePresence>
        {running ? clock(now - start) : "00:00"}
      </div>
      <div className="txt">{running ? runText : tr(idleText)}</div>
      <motion.button className={`btn ${running ? "" : "ghost"}`} onClick={(e) => (running ? onStop(e) : onStart())} {...tap}>
        {running ? tr(stopLabel) : tr(startLabel)}
      </motion.button>
    </motion.div>
  );
}
