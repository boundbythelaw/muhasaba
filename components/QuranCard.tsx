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
import { clampRange, revisionStatus, STALE_DAYS } from "@/lib/revision";
import { revPages } from "@/lib/scoring";
import { revBonus } from "@/lib/bonus";
import { Bar } from "./ui";

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
        <CheckRow on={q.juz} title={tr("Read 1 juz")} sub={tr("Daily recitation")} points={5} onToggle={toggle("juz")} />
        <CheckRow on={q.mulkSubh} title={tr("Sūrat al-Mulk after Subh")} points={2.5} onToggle={toggle("mulkSubh")} />
        <CheckRow on={q.mulkMaghrib} title={tr("Sūrat al-Mulk after Maghrib")} points={2.5} onToggle={toggle("mulkMaghrib")} />
      </div>

      <Murajaa />

      <div className="ch">
        <div className="lab">{tr("Your Mushaf")} · {po.done}/{MUSHAF_PAGES}</div>
        <div className="lab num">{((po.done / MUSHAF_PAGES) * 100).toFixed(1)}%</div>
      </div>
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
    </CardShell>
  );
}

/** Murājaʿa: log the pages you revised today, and see which memorised pages are getting old. */
function Murajaa() {
  const { day, days, prefs, cur, update, locked, requestUnlock } = useStore();
  const st = useMemo(() => revisionStatus(days, prefs, cur), [days, prefs, cur]);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const today = revPages(day.rev);
  const add = (from: number, to: number) => {
    if (locked) { requestUnlock(cur); return; }
    const r = clampRange(from, to);
    if (!r) return;
    void update((d) => { d.rev.push(r); }, null, true, { noConfirm: true }).then((ok) => {
      if (ok) { setA(""); setB(""); haptic(10); toast(tr("{n} pages revised. Bārak Allāhu fīk.", { n: r.to - r.from + 1 })); }
    });
  };
  const pct = st.memorised ? (st.fresh / st.memorised) * 100 : 0;
  return (
    <div className="murajaa">
      <div className="ch">
        <div className="lab">{tr("Murājaʿa · revision")} <span className="ar" style={{ fontSize: 15 }}>مراجعة</span></div>
        <div className="lab num">{today ? `${today}p · +${Math.round(revBonus(day) * 10) / 10} ✦` : tr("bonus ✦")}</div>
      </div>
      <Bar pct={pct} max={st.stale === 0 && st.memorised > 0} />
      <p className="note">
        {st.memorised === 0 ? tr("Pages you memorise will show up here.")
          : st.stale === 0 ? tr("Every memorised page was revised in the last {d} days. Mā shāʾ Allāh.", { d: STALE_DAYS })
          : tr("{s} of {m} memorised pages not revised in the last {d} days.", { s: st.stale, m: st.memorised, d: STALE_DAYS })}
      </p>
      {st.next && (
        <motion.button className="revnext" {...tap} onClick={() => add(st.next!.from, st.next!.to)}>
          <span><small>{tr("Next to revise")}</small><b className="num">{tr("Pages {a}–{b}", { a: st.next.from, b: st.next.to })}</b></span>
          <em>{tr("I revised these")}</em>
        </motion.button>
      )}
      <div className="revadd">
        <input className="inp num" type="number" inputMode="numeric" placeholder={tr("from")} aria-label={tr("From page")} value={a} onChange={(e) => setA(e.target.value)} />
        <span>–</span>
        <input className="inp num" type="number" inputMode="numeric" placeholder={tr("to")} aria-label={tr("To page")} value={b} onChange={(e) => setB(e.target.value)} />
        <motion.button className="btn" {...tap} disabled={!a} onClick={() => add(Number(a), Number(b || a))}>{tr("Add")}</motion.button>
      </div>
      {day.rev.length > 0 && (
        <div className="row revlist">
          {day.rev.map((r, i) => (
            <span className="revchip num" key={`${r.from}-${r.to}-${i}`}>
              {r.from === r.to ? `p. ${r.from}` : `p. ${r.from}–${r.to}`}
              <button aria-label={tr("Remove")} onClick={() => update((d) => { d.rev.splice(i, 1); }, null)}>×</button>
            </span>
          ))}
        </div>
      )}
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
