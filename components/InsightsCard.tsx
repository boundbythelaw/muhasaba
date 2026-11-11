"use client";
import { motion } from "framer-motion";
import { useMemo, useState } from "react";
import { computeInsights, BAD, type Bucket } from "@/lib/insights";
import { loc, tr } from "@/lib/i18n";
import { shortDate } from "@/lib/dates";
import { fmt } from "@/lib/scoring";
import { useStore } from "@/lib/store";
import { tap } from "./ui";

const WD = (w: number) => new Date(2024, 0, 7 + w).toLocaleDateString(loc(), { weekday: "short" });
const pct = (x: number | null) => (x == null ? "–" : `${Math.round(x * 100)}%`);

function Bars({ items, max = 100 }: { items: { label: string; v: number | null; n?: number; hi?: boolean; lo?: boolean }[]; max?: number }) {
  return (
    <div className="ibars">
      {items.map((it, i) => (
        <div className={`ibar ${it.hi ? "hi" : ""} ${it.lo ? "lo" : ""}`} key={it.label + i}>
          <span className="il">{it.label}</span>
          <span className="it"><motion.i initial={{ width: 0 }} animate={{ width: `${it.v == null ? 0 : Math.max(3, (it.v / max) * 100)}%` }} transition={{ delay: i * 0.04, type: "spring", stiffness: 140, damping: 20 }} /></span>
          <span className="iv num">{it.v == null ? "–" : Math.round(it.v)}{it.n != null && <small> · {it.n}d</small>}</span>
        </div>
      ))}
    </div>
  );
}

const fromBuckets = (bs: Bucket[]) => {
  const vals = bs.filter((b) => b.avg != null).map((b) => b.avg!);
  const hi = Math.max(...vals), lo = Math.min(...vals);
  return bs.map((b) => ({ label: tr(b.label), v: b.avg, n: b.n, hi: vals.length > 1 && b.avg === hi, lo: vals.length > 1 && b.avg === lo }));
};

function Need({ n, of }: { n: number; of: number }) {
  return <p className="empty">{tr("Needs {k} more days of data. Patterns start to mean something after about {of}.", { k: Math.max(0, of - n), of })}</p>;
}

/** What your days say about you. The full version lives in the Insights tab of your Google Sheet. */
export default function InsightsCard() {
  const { days, goTo, setView } = useStore();
  const I = useMemo(() => computeInsights(days), [days]);
  const [tab, setTab] = useState<"days" | "salah" | "causes" | "hifz">("days");
  const open = (k: string) => { goTo(k); setView("today"); window.scrollTo({ top: 0, behavior: "smooth" }); };
  return (
    <section className="card insights">
      <div className="ch"><h2>{tr("Insights")}<span className="ar">بصيرة</span></h2><span className="lab num">{I.n} {tr("days")}</span></div>
      <div className="itabs" role="tablist">
        {(["days", "salah", "causes", "hifz"] as const).map((x) => (
          <motion.button key={x} role="tab" aria-selected={tab === x} className={tab === x ? "on" : ""} {...tap} onClick={() => setTab(x)}>
            {tr({ days: "Days", salah: "Salah", causes: "Causes", hifz: "Ḥifẓ" }[x])}
          </motion.button>
        ))}
      </div>

      {tab === "days" && (I.n < 7 ? <Need n={I.n} of={21} /> : (
        <>
          <div className="lab">{tr("Average score by weekday")}</div>
          <Bars items={I.weekday.map((w) => ({ label: WD(w.wd), v: w.avg, n: w.n, hi: w.wd === I.bestWd?.wd, lo: w.wd === I.worstWd?.wd }))} />
          {I.bestWd && I.worstWd && (
            <p className="note">{tr("Your best day is {a} ({x}), your hardest is {b} ({y}).", { a: WD(I.bestWd.wd), x: Math.round(I.bestWd.avg!), b: WD(I.worstWd.wd), y: Math.round(I.worstWd.avg!) })}</p>
          )}
          <div className="lab">{tr("After a bad day (under {n})", { n: BAD })}</div>
          {I.rebound.n ? (
            <p className="note">{tr("{n} bad days so far. The next day you averaged {a}: better {b}×, worse {w}×.", { n: I.rebound.n, a: Math.round(I.rebound.nextAvg!), b: I.rebound.better, w: I.rebound.worse })}</p>
          ) : <p className="note">{tr("No bad days yet. Al-ḥamdu lillāh.")}</p>}
          <div className="ibest">
            <div><div className="lab">{tr("Best days")}</div>{I.best.map((r) => <button key={r.k} onClick={() => open(r.k)}><b className="num">{fmt(r.s.total)}</b> {shortDate(r.k)}</button>)}</div>
            <div><div className="lab">{tr("Hardest days")}</div>{I.worst.map((r) => <button key={r.k} onClick={() => open(r.k)}><b className="num">{fmt(r.s.total)}</b> {shortDate(r.k)}</button>)}</div>
          </div>
        </>
      ))}

      {tab === "salah" && (I.n < 5 ? <Need n={I.n} of={14} /> : (
        <>
          <div className="lab">{tr("Before the takbīr, per prayer")}</div>
          <Bars items={I.prayers.map((p) => ({ label: tr(p.en), v: p.takbir == null ? null : p.takbir * 100, hi: false, lo: I.hardest?.id === p.id }))} />
          {I.hardest && <p className="note">{tr("Your hardest prayer is {p}: before the takbīr {x} of the time, in the mosque {m}.", { p: tr(I.hardest.en), x: pct(I.hardest.takbir), m: pct(I.hardest.mosque) })}</p>}
          <div className="lab">{tr("Why you were late or missed the mosque")}</div>
          {I.reasons.length ? <Bars max={Math.max(...I.reasons.map((r) => r.n))} items={I.reasons.map((r) => ({ label: tr(r.label), v: r.n }))} /> : <p className="note">{tr("Reasons you pick on the Salah card will show up here.")}</p>}
        </>
      ))}

      {tab === "causes" && (I.checkins < 7 ? <Need n={I.checkins} of={30} /> : (
        <>
          <div className="lab">{tr("Score by hours of sleep")}</div>
          <Bars items={fromBuckets(I.sleep)} />
          <div className="lab">{tr("Score by bedtime")}</div>
          <Bars items={fromBuckets(I.bedtime)} />
          <div className="lab">{tr("Score by phone & scrolling")}</div>
          <Bars items={fromBuckets(I.phone)} />
          {I.slip.n > 0 && (
            <p className="note">{tr("On the {n} days you slipped, you slept {a} h on average (other days {b} h), and scrolled a lot on {p} of them (other days {q}). Tawbah made {t} of {n} times.", {
              n: I.slip.n, a: fmt(I.slip.sleepSlip ?? 0), b: fmt(I.slip.sleepClean ?? 0), p: pct(I.slip.phoneLotSlip), q: pct(I.slip.phoneLotClean), t: I.slip.tawbah })}</p>
          )}
        </>
      ))}

      {tab === "hifz" && (
        I.perPage == null ? <p className="empty">{tr("Log the minutes on the Qur'an card and your pace shows up here.")}</p> : (
          <>
            <div className="istat"><b className="num">{Math.round(I.perPage)}</b><span>{tr("minutes per page on average")}</span></div>
            <Bars max={Math.max(...I.byDiff.map((d) => d.avg ?? 0), 1)} items={I.byDiff.map((d) => ({ label: tr(d.diff === "easy" ? "Easy" : d.diff === "normal" ? "Normal" : "Hard"), v: d.avg }))} />
          </>
        )
      )}
      <p className="empty">{tr("Much more in the Insights tab of your Google Sheet, updated every night.")}</p>
    </section>
  );
}
