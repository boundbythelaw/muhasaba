"use client";
import { loc, tr } from "@/lib/i18n";
import { AnimatePresence, motion } from "framer-motion";
import { MUSHAF_PAGES } from "@/lib/constants";
import { addDays, parseKey, todayKey } from "@/lib/dates";
import { haptic, toast } from "@/lib/fx";
import { juzFill, juzOf, juzRange, pagesBefore, portion } from "@/lib/scoring";
import { useStore } from "@/lib/store";
import type { Difficulty, QuranLog } from "@/lib/types";
import TimerBar from "./TimerBar";
import { CardShell, CheckRow, Pill, Segmented, tap } from "./ui";
import { useEffect, useMemo, useState } from "react";
import { murajaaPlan, rangeOf } from "@/lib/murajaa";
import { Disclose } from "./ui";

export default function QuranCard() {
  const { day, days, prefs, cur, scores, update, timers, setTimers } = useStore();
  const q = day.quran;
  const po = portion(days, prefs, cur);
  const remain = MUSHAF_PAGES - po.done;
  const finish = parseKey(cur);
  finish.setDate(finish.getDate() + Math.ceil(remain / 2));
  const isToday = cur === todayKey();
  const running = timers.hifz?.day === cur ? timers.hifz : null;
  const curJuz = juzOf(po.from);
  const toggle = (f: keyof Pick<QuranLog, "preview" | "juz" | "mulkSubh" | "mulkMaghrib">) => (e: React.MouseEvent) =>
    update((d) => { d.quran[f] = !d.quran[f]; }, e);

  return (
    <CardShell id="sec-q" title={tr("Qur'an")} ar="القرآن" value={scores.q} max={30} done={scores.q >= 30} summary={tr("Pages {a}–{b} memorised, juz read, Al-Mulk twice", { a: po.from, b: po.to })}>

      <div className="portion">
        <div>
          <div className="lab">{tr("Today's ḥifẓ")}</div>
          <motion.div key={po.from} className="big num" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>{tr("Pages {a}–{b}", { a: po.from, b: po.to })}</motion.div>
          <div className="meta">{tr("Juz {j} · {n} pages memorised before today", { j: curJuz, n: po.done })}</div>
        </div>
        <div className="ar">حفظ</div>
      </div>

      {(isToday || running) && (
        <Disclose label={running ? tr("⏱ Timer running") : tr("⏱ Time your ḥifẓ")} open={!!running}>
        <TimerBar
          start={running?.start ?? null}
          idleText="Time your memorisation. It fills in the minutes for you."
          runText={tr("Memorising… tap Done when both pages are solid.")}
          startLabel="Start" stopLabel="Done"
          onStart={() => { setTimers((t) => ({ ...t, hifz: { day: cur, start: Date.now() } })); haptic(15); toast(tr("Bismillāh. Timer running.")); }}
          onStop={(e) => {
            const start = timers.hifz?.start ?? Date.now();
            const m = Math.max(1, Math.round((Date.now() - start) / 60000));
            setTimers((t) => { delete t.hifz; return t; });
            update((d) => { d.quran.minutes = (d.quran.minutes ?? 0) + m; if (!d.quran.mem) d.quran.mem = 2; }, e, false, { noConfirm: true });
            toast(tr("{m} min logged. Switch to 1 page if you only got one.", { m }));
          }}
        />
        </Disclose>
      )}

      <div className="lab">{tr("Memorised today?")}</div>
      <Segmented ariaLabel={tr("Pages memorised")} value={Math.min(q.mem, 3)}
        options={[{ value: 0, label: "Not yet" }, { value: 1, label: "1 page", sub: "+7" }, { value: 2, label: "Both pages", sub: "+15", tone: "top" }, { value: 3, label: "3+", sub: "more", tone: "top" }]}
        onSelect={(v, e) => update((d) => { d.quran.mem = v === 3 ? Math.max(3, d.quran.mem) : v; }, e)} />
      <AnimatePresence initial={false}>
        {q.mem >= 3 && (
          <motion.div className="morepages" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <motion.button className="sb" aria-label={tr("One page fewer")} {...tap} onClick={(e) => update((d) => { d.quran.mem = Math.max(2, d.quran.mem - 1); }, e)}>−</motion.button>
            <div className="mp-val"><b className="num">{q.mem}</b> <span>{tr("pages today")}</span></div>
            <motion.button className="sb" aria-label={tr("One page more")} {...tap} onClick={(e) => update((d) => { d.quran.mem = Math.min(40, d.quran.mem + 1); }, e)}>+</motion.button>
            <p className="note">{tr("Mā shāʾ Allāh. Tomorrow starts at page {p}.", { p: Math.min(po.from + q.mem, 604) })}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {(q.mem > 0 || q.minutes) && (
          <motion.div className="detail" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            <div className="lab">{tr("How long did it take?")}</div>
            <div className="row">
              {[15, 30, 45, 60, 90].map((m) => (
                <Pill key={m} on={q.minutes === m} onClick={(e) => update((d) => { d.quran.minutes = d.quran.minutes === m ? null : m; }, e, true)}>{m}m</Pill>
              ))}
              <MinutesInput value={q.minutes} onCommit={(n) => update((d) => { d.quran.minutes = n; }, null, true)} />
            </div>
            <div className="lab">{tr("How did it feel?")}</div>
            <Segmented<Difficulty> ariaLabel={tr("Difficulty")} value={q.diff}
              options={[{ value: "easy", label: "Easy", sub: "Smooth" }, { value: "normal", label: "Normal", sub: "Steady" }, { value: "hard", label: "Hard", sub: "Fought for it" }]}
              onSelect={(v) => { haptic(8); update((d) => { d.quran.diff = d.quran.diff === v ? null : v; }, null, true); }} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="checks">
        <CheckRow on={q.preview} title={tr("Previewed tomorrow's pages")} sub={tr("Pages {a}–{b}", { a: po.previewFrom, b: po.previewTo })} points={5} onToggle={toggle("preview")} />
        <MurajaaRow />
        <CheckRow on={q.mulkSubh} title={tr("Sūrat al-Mulk after Subh")} points={2.5} onToggle={toggle("mulkSubh")} />
        <CheckRow on={q.mulkMaghrib} title={tr("Sūrat al-Mulk after Maghrib")} points={2.5} onToggle={toggle("mulkMaghrib")} />
      </div>

      <Disclose label={`${tr("Your Mushaf")} · ${po.done}/${MUSHAF_PAGES} · ${((po.done / MUSHAF_PAGES) * 100).toFixed(1)}%`}>
      <div className="juz">
        {Array.from({ length: 30 }, (_, i) => {
          const j = i + 1, f = juzFill(j, po.done);
          return (
            <motion.button key={j} className={`${f >= 1 ? "full" : ""} ${j === curJuz && f < 1 ? "cur" : ""}`} aria-label={`Juz ${j}`}
              whileTap={{ scale: 0.85 }} whileHover={{ y: -2 }}
              onClick={() => {
                const [a, b] = juzRange(j);
                const doneAfter = pagesBefore(days, prefs, addDays(cur, 1));
                haptic(5);
                toast(tr("Juz {j} · pages {a}–{b} · {p}% memorised", { j, a, b, p: Math.round(juzFill(j, doneAfter) * 100) }));
              }}>
              <motion.div className="f" initial={{ height: 0 }} animate={{ height: `${f * 100}%` }} transition={{ delay: i * 0.015, type: "spring", stiffness: 120, damping: 20 }} />
              <span>{j}</span>
            </motion.button>
          );
        })}
      </div>
      <p className="note">
        {remain > 0
          ? <>{tr("At 2 pages a day you'll complete the Mushaf around")} <b>{finish.toLocaleDateString(loc(), { month: "long", year: "numeric" })}</b>{tr(", in shāʾ Allāh.")}</>
          : tr("Mushaf complete. Al-ḥamdu lillāh.")}
      </p>
      </Disclose>
    </CardShell>
  );
}

/**
 * Murājaʿa: one juz a day over your memorised pages, in order, then back to juz 1.
 * Ticking it counts as the daily juz (+5); the juz you read sets tomorrow's.
 */
function MurajaaRow() {
  const { day, days, prefs, cur, update } = useStore();
  const plan = useMemo(() => murajaaPlan(days, prefs, cur), [days, prefs, cur]);
  const [pick, setPick] = useState(false);
  const q = day.quran;
  if (!plan.lastJuz) {
    return <CheckRow on={q.juz} title={tr("Murājaʿa · read 1 juz")} sub={tr("Daily revision")} points={5}
      onToggle={(e) => update((d) => { d.quran.juz = !d.quran.juz; }, e)} />;
  }
  const r = plan.range!;
  const set = (j: number, on: boolean, e: React.MouseEvent | null) => update((d) => {
    d.quran.juz = on;
    if (on) { const x = rangeOf(j, plan.memorised); d.quran.revJuz = j; d.rev = [{ from: x.from, to: x.to }]; }
    else { delete d.quran.revJuz; d.rev = []; }
  }, e);
  return (
    <div className="murajaa2">
      <CheckRow on={q.juz}
        title={tr("Murājaʿa · Juz {j}", { j: plan.juz })}
        sub={`${r.surahs[0]}${r.partial ? "" : ` → ${r.surahs[1]}`} · ${tr("pages {a}–{b}", { a: r.from, b: r.to })}${r.partial ? ` (${tr("memorised part")})` : ""}`}
        points={5} onToggle={(e) => set(plan.juz, !q.juz, e)} />
      <button className="linkbtn" onClick={() => setPick((x) => !x)}>
        {pick ? tr("Close") : tr("Read a different juz?")}
      </button>
      <AnimatePresence initial={false}>
        {pick && (
          <motion.div className="juzpick" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            {Array.from({ length: plan.lastJuz }, (_, i) => i + 1).map((j) => (
              <motion.button key={j} {...tap} className={j === plan.juz ? "on" : ""} onClick={(e) => { void set(j, true, e); setPick(false); haptic(8); }}>{j}</motion.button>
            ))}
            <p className="note">{tr("Tomorrow continues from the juz you pick. Your cycle: juz 1 to {n}, then again.", { n: plan.lastJuz })}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Typed minutes are saved when you leave the box, so the change popup never interrupts typing. */
function MinutesInput({ value, onCommit }: { value: number | null; onCommit: (n: number | null) => void }) {
  const [v, setV] = useState(value == null ? "" : String(value));
  useEffect(() => setV(value == null ? "" : String(value)), [value]);
  const commit = () => {
    const n = parseInt(v, 10);
    const next = isNaN(n) ? null : Math.max(0, n);
    if (next !== value) onCommit(next);
  };
  return (
    <input className="inp" type="number" inputMode="numeric" min={0} placeholder={tr("min")} aria-label={tr("Minutes")} value={v}
      onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
  );
}
