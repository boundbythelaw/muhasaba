"use client";
import { loc, tr } from "@/lib/i18n";
import { motion } from "framer-motion";
import { useRef, useState } from "react";
import { MAX, PILLAR_NAME, PRAYERS, STEP_GOAL, type Pillar } from "@/lib/constants";
import { addDays, birthday, keyOf, parseKey, shortDate, todayKey } from "@/lib/dates";
import { burst, toast } from "@/lib/fx";
import { fmt, isMax, pagesBefore, scoreDay } from "@/lib/scoring";
import { useStore } from "@/lib/store";
import SheetCard from "./SheetCard";
import { ProfileCard } from "./Profile";
import InsightsCard from "./InsightsCard";
import { Bar, tap } from "./ui";

export default function RecordView() {
  const { days, prefs, cur, goTo, setView, setPrefs, exportData, importData } = useStore();
  const [month, setMonth] = useState(() => { const d = parseKey(cur); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const fileRef = useRef<HTMLInputElement>(null);
  const t = todayKey();
  const total = (k: string) => (days[k] ? scoreDay(days[k]).total : null);

  // streaks (days at 70+)
  let k = (total(t) ?? 0) >= 70 ? t : addDays(t, -1), streak = 0;
  while ((total(k) ?? -1) >= 70) { streak++; k = addDays(k, -1); }
  let best = 0, run = 0, prev: string | null = null;
  for (const x of Object.keys(days).filter((d) => d <= t).sort()) {
    const ok = (total(x) ?? 0) >= 70;
    run = ok ? (prev && addDays(prev, 1) === x ? run + 1 : 1) : 0;
    if (!ok) prev = null; else prev = x;
    best = Math.max(best, run);
  }

  const last7 = Array.from({ length: 7 }, (_, i) => addDays(t, -i)).filter((d) => days[d]);
  const avg = last7.length ? last7.reduce((a, d) => a + (total(d) ?? 0), 0) / last7.length : 0;
  let prayed = 0, mosque = 0, early = 0, hrs = 0, walks = 0, bonusPts = 0, tahajjud = 0;
  const pil: Record<Pillar, number> = { p: 0, q: 0, w: 0, s: 0 };
  for (const d of last7) {
    const log = days[d], s = scoreDay(log);
    (Object.keys(pil) as Pillar[]).forEach((x) => (pil[x] += s[x]));
    for (const { id } of PRAYERS) { const v = log.prayers[id]; if (v != null) { prayed++; if (v >= 1) mosque++; if (v === 2) early++; } }
    hrs += log.work.hours || 0;
    bonusPts += s.bonus;
    if (log.bonus.tahajjud) tahajjud++;
    if ((log.steps ?? 0) >= STEP_GOAL) walks++;
  }
  const weakest = last7.length ? (Object.keys(pil) as Pillar[]).sort((a, b) => pil[a] / MAX[a] - pil[b] / MAX[b])[0] : null;
  const memorised = pagesBefore(days, prefs, addDays(t, 1)) - (Number(prefs.basePage) || 0);
  const bd = birthday();
  const open = (d: string) => { goTo(d); setView("today"); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const stats: [string, string, boolean?][] = [
    [String(streak), tr("day streak at 70+ · best {n}", { n: best }), true],
    [String(Math.round(avg)), tr("7-day average")],
    [`${prayed ? Math.round((mosque / prayed) * 100) : 0}%`, tr("prayers in the mosque")],
    [String(early), tr("before takbīr this week")],
    [String(memorised), tr("pages memorised since {d}", { d: shortDate(prefs.baseDate) })],
    [`${fmt(hrs)}h`, tr("MuslimPreneur · {w}/7 walks", { w: walks })],
    [`+${fmt(bonusPts)}`, tr("✦ bonus this week"), true],
    [String(tahajjud), tr("nights of tahajjud this week")],
  ];

  const ks = Array.from({ length: 14 }, (_, i) => addDays(t, i - 13));
  const y = month.getFullYear(), m = month.getMonth();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7, dim = new Date(y, m + 1, 0).getDate();
  const canNext = keyOf(new Date(y, m + 1, 1)) <= t;

  const doExport = () => {
    const blob = new Blob([exportData()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `muhasaba-backup-${t}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(tr("Backup saved."));
  };
  const doImport = async (f: File) => {
    try {
      const n = importData(JSON.parse(await f.text()));
      burst(innerWidth / 2, innerHeight / 3);
      toast(tr("{n} days loaded.", { n }));
    } catch {
      toast(tr("That file isn't a Muhasaba backup."));
    }
  };

  return (
    <>
      <section className="stats">
        {stats.map(([v, l, flame], i) => (
          <motion.div key={l} className={`stat ${flame ? "flame" : ""}`} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <b className="num">{v}</b><span>{l}</span>
          </motion.div>
        ))}
      </section>

      <section className="card">
        <div className="ch"><h2>{tr("Last 14 days")}</h2><p className="sub" style={{ margin: 0 }}>{tr("Tap a bar to open it")}</p></div>
        {!Object.keys(days).length && <p className="empty">{tr("Your bars appear here once you log your first day. Aim to stay above the dotted 70 line.")}</p>}
        <div className="chart">
          <div className="goal"><span>70</span></div>
          {ks.map((d, i) => {
            const v = total(d);
            return (
              <motion.button key={d} className={d === cur ? "on" : ""} onClick={() => open(d)} aria-label={`${d}${v != null ? `, score ${Math.round(v)}` : ""}`} whileTap={{ scale: 0.9 }}>
                {v != null && <>
                  <small className="num">{Math.round(v)}</small>
                  <motion.div className={`b ${v >= 90 ? "hi" : v < 50 ? "lo" : ""}`} initial={{ height: 0 }} animate={{ height: `${Math.max(v, 2)}%` }} transition={{ delay: i * 0.03, type: "spring", stiffness: 140, damping: 18 }} />
                </>}
              </motion.button>
            );
          })}
        </div>
        <div className="xl num">{ks.map((d) => <span key={d}>{parseKey(d).getDate()}</span>)}</div>
      </section>

      <InsightsCard />

      <section className="card">
        <div className="ch"><h2>{tr("This week by pillar")}</h2></div>
        <div className="pbars">
          {(Object.keys(MAX) as Pillar[]).map((x) => {
            const v = last7.length ? pil[x] / last7.length : 0;
            return (
              <div className="pl" key={x}>
                <span className="lbl">{tr(PILLAR_NAME[x])}</span>
                <Bar pct={(v / MAX[x]) * 100} max={isMax(x, v)} />
                <span className="pts num">{Math.round((v / MAX[x]) * 100)}%</span>
              </div>
            );
          })}
        </div>
        {weakest && <p className="empty">{tr("Weakest pillar this week:")} <b>{tr(PILLAR_NAME[weakest])}</b>{tr(". That's where the easiest points are.")}</p>}
      </section>

      <section className="card">
        <div className="ch">
          <div className="monthnav">
            <motion.button className="navbtn" aria-label={tr("Previous month")} onClick={() => setMonth(new Date(y, m - 1, 1))} {...tap}>‹</motion.button>
            <h2>{month.toLocaleDateString(loc(), { month: "long", year: "numeric" })}</h2>
            <motion.button className="navbtn" aria-label={tr("Next month")} disabled={!canNext} onClick={() => setMonth(new Date(y, m + 1, 1))} {...tap}>›</motion.button>
          </div>
        </div>
        <motion.div key={`${y}-${m}`} className="cal" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}>
          {["M", "T", "W", "T", "F", "S", "S"].map((x, i) => <div className="h" key={i}>{x}</div>)}
          {Array.from({ length: lead }, (_, i) => <div key={`l${i}`} />)}
          {Array.from({ length: dim }, (_, i) => {
            const d = keyOf(new Date(y, m, i + 1)), v = total(d), isBd = !!bd && m === bd.month - 1 && i + 1 === bd.day;
            const style = v != null ? { background: `color-mix(in srgb, var(--accent) ${Math.round(15 + v * 0.85)}%, var(--raised))`, color: v >= 55 ? "var(--accent-ink)" : "var(--ink)" } : undefined;
            return (
              <motion.button key={d} className={`${d === cur ? "on" : ""} ${isBd ? "bd" : ""}`} disabled={d > t} style={style} onClick={() => open(d)}
                aria-label={`${d}${v != null ? `, score ${Math.round(v)}` : ""}`} whileTap={{ scale: 0.88 }}>
                <span className="num">{i + 1}</span>{v != null && <small className="num">{Math.round(v)}</small>}
              </motion.button>
            );
          })}
        </motion.div>
        {bd && <p className="empty">{bd.daysTo === 0 ? tr("Today is your birthday. {a} years old.", { a: bd.age }) : tr("{n} days until you turn {a}.", { n: bd.daysTo, a: bd.age })}</p>}
      </section>

      <ProfileCard />

      <SheetCard />

      <section className="card">
        <div className="ch"><h2>{tr("Ḥifẓ settings")}</h2></div>
        <div className="settings">
          <label>{tr("Pages memorised before the start date")}
            <input className="inp" type="number" min={0} max={604} value={prefs.basePage}
              onChange={(e) => { const n = parseInt(e.target.value, 10); if (!isNaN(n)) setPrefs({ basePage: Math.max(0, Math.min(604, n)) }); }} />
          </label>
          <label>{tr("Start date")}
            <input className="inp" type="date" value={prefs.baseDate} onChange={(e) => { if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) setPrefs({ baseDate: e.target.value }); }} />
          </label>
          <p className="empty">{tr("Each day's pages follow from what you actually memorised, so a missed day never skips pages.")}</p>
        </div>
      </section>

      <section className="card">
        <div className="ch"><h2>{tr("Backup")}</h2></div>
        <p className="empty">{tr("Save all your days to a file, or load a backup from another phone or from the Claude version.")}</p>
        <div className="row">
          <motion.button className="btn" onClick={doExport} {...tap}>{tr("Save backup")}</motion.button>
          <motion.button className="btn ghost" onClick={() => fileRef.current?.click()} {...tap}>{tr("Load backup")}</motion.button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) doImport(f); }} />
        </div>
      </section>
    </>
  );
}
