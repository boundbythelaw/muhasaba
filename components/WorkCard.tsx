"use client";
import { tr } from "@/lib/i18n";
import { AnimatePresence, motion } from "framer-motion";
import { TOPICS } from "@/lib/constants";
import { todayKey } from "@/lib/dates";
import { haptic, toast } from "@/lib/fx";
import { fmt } from "@/lib/scoring";
import { useStore } from "@/lib/store";
import TimerBar from "./TimerBar";
import { Disclose } from "./ui";
import { CardShell, Pill, tap } from "./ui";

export default function WorkCard() {
  const { day, cur, scores, update, timers, setTimers, locked, requestUnlock } = useStore();
  const w = day.work;
  const hv = w.hours || 0;
  const running = timers.work?.day === cur ? timers.work : null;
  const isToday = cur === todayKey();

  return (
    <CardShell id="sec-w" title={tr("Productivity")} ar="الإنتاج" value={scores.w} max={20} done={scores.w >= 20} summary={`${fmt(hv)}h${w.topics.length ? " · " + w.topics.map((x) => tr(x)).join(", ") : ""}`}>
      <p className="sub">{tr("Work, learning the dīn, studies, skills, helping family: anything that moves you forward. 1h = 8 · 2h = 14 · 3h+ = 20")}</p>

      {(isToday || running) && (
        <Disclose label={running ? tr("⏱ Focus session running") : tr("⏱ Focus timer")} open={!!running}>
        <TimerBar
          start={running?.start ?? null}
          idleText="Start a focus session. Pick a topic below first."
          runText={tr("Deep work on {x}…", { x: running?.topic ? tr(running.topic) : tr("something productive") })}
          startLabel="Start" stopLabel="Stop"
          onStart={() => { setTimers((t) => ({ ...t, work: { day: cur, start: Date.now(), topic: w.topics[0] ?? "" } })); haptic(15); toast(tr("Focus session started. Phone face down.")); }}
          onStop={(e) => {
            const tm = timers.work;
            const hrs = tm ? Math.round((Date.now() - tm.start) / 900000) / 4 : 0;
            setTimers((t) => { delete t.work; return t; });
            update((d) => {
              d.work.hours = Math.min(14, (d.work.hours || 0) + hrs);
              if (tm?.topic && !d.work.topics.includes(tm.topic)) d.work.topics.push(tm.topic);
            }, e, false, { noConfirm: true });
            toast(hrs ? tr("{h}h of productive time added.", { h: hrs }) : tr("Under 8 minutes, nothing added."));
          }}
        />
        </Disclose>
      )}

      <div className="stepper">
        <motion.button className="sb" aria-label={tr("Less time")} {...tap} onClick={(e) => update((d) => { d.work.hours = Math.max(0, (d.work.hours || 0) - 0.5); }, e)}>−</motion.button>
        <div className="hv num">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span key={hv} initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -14, opacity: 0 }} style={{ display: "inline-block" }}>{fmt(hv)}</motion.span>
          </AnimatePresence>
          <small> {tr("h")}</small>
        </div>
        <motion.button className="sb" aria-label={tr("More time")} {...tap} onClick={(e) => update((d) => { d.work.hours = Math.min(14, (d.work.hours || 0) + 0.5); }, e)}>+</motion.button>
        <div className="row">
          {[1, 2, 3].map((h) => <Pill key={h} on={hv === h} onClick={(e) => update((d) => { d.work.hours = h; }, e)}>{h}h{h === 3 ? "+" : ""}</Pill>)}
        </div>
      </div>

      <div className="lab">{tr("What was productive today?")}</div>
      <div className="row">
        {TOPICS.map((t) => (
          <Pill key={t} on={w.topics.includes(t)} onClick={() => {
            haptic(6);
            const adding = !w.topics.includes(t);
            update((d) => { const i = d.work.topics.indexOf(t); if (i < 0) d.work.topics.push(t); else d.work.topics.splice(i, 1); }, null, true);
            if (adding && running) setTimers((x) => (x.work ? { ...x, work: { ...x.work, topic: t } } : x));
          }}>{tr(t)}</Pill>
        ))}
      </div>
      <textarea aria-label={tr("Work notes")} readOnly={locked} onFocus={() => { if (locked) requestUnlock(cur); }} placeholder={tr("What did you do? e.g. finished the school website, read 30 pages of the Seerah")}
        value={w.note} onChange={(e) => { const v = e.target.value.slice(0, 2000); update((d) => { d.work.note = v; }, null, true); }} />
    </CardShell>
  );
}
