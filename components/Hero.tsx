"use client";
import { tr } from "@/lib/i18n";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { useState } from "react";
import { MAX, PILLAR_NAME, PRAYERS, STEP_GOAL, type Pillar } from "@/lib/constants";
import { getLang, getName, num } from "@/lib/i18n";
import { fmtTime, nextPrayer, timesFor, untilText } from "@/lib/prayerTimes";
import { useEffect } from "react";
import { addDays, birthday, greeting, hijri, longDate, ordinal, todayKey } from "@/lib/dates";
import { burst, toast } from "@/lib/fx";
import { fmt, grade, isMax, portion } from "@/lib/scoring";
import type { DayLog, Scores } from "@/lib/types";
import { useStore } from "@/lib/store";
import { AnimatedNumber, Bar, tap } from "./ui";

const R = 54;
const C = 2 * Math.PI * R;
const GAP = 6;
/** The ring is split into the four pillars, each as long as its share of the 100 points. */
const SEGMENTS = (() => {
  let at = 0;
  return (Object.keys(MAX) as Pillar[]).map((k) => {
    const full = (MAX[k] / 100) * C;
    const seg = { k, start: at + GAP / 2, len: full - GAP };
    at += full;
    return seg;
  });
})();

/** The next few points worth earning, in the order of the day. */
function nextUp(day: DayLog, scores: Scores, portionText: string, started: (id: string) => boolean): { text: string; pts: string; target: Pillar | "journal" } {
  // Only prayers whose time has already come are worth logging now.
  const firstPrayer = PRAYERS.find(({ id }) => day.prayers[id] == null && started(id));
  if (firstPrayer) return { text: tr("Log {p}", { p: tr(firstPrayer.en) }), pts: tr("up to +8"), target: "p" };
  if (day.quran.mem < 2) return { text: tr("Memorise {x}", { x: portionText }), pts: day.quran.mem ? "+8" : "+15", target: "q" };
  if (!day.quran.mulkSubh) return { text: tr("Al-Mulk after Subh"), pts: "+2.5", target: "q" };
  if (!day.quran.juz) return { text: tr("Read your juz"), pts: "+5", target: "q" };
  if (!day.quran.preview) return { text: tr("Preview tomorrow's pages"), pts: "+5", target: "q" };
  if (!day.quran.mulkMaghrib) return { text: tr("Al-Mulk after Maghrib"), pts: "+2.5", target: "q" };
  if (scores.w < 20) return { text: tr("Deep work on MuslimPreneur"), pts: `+${fmt(20 - scores.w)}`, target: "w" };
  if (scores.s < 10) return { text: tr("Walk {n} more steps", { n: num(STEP_GOAL - (day.steps ?? 0)) }), pts: `+${fmt(10 - scores.s)}`, target: "s" };
  return { text: tr("Everything's done. Write about your day"), pts: "✎", target: "journal" };
}

export default function Hero({ onJump }: { onJump: (p: Pillar | "journal") => void }) {
  const { cur, dir, scores, shiftDay, goTo, day, days, prefs } = useStore();
  const po = portion(days, prefs, cur);
  const isTodayKey = cur === todayKey();
  let times: Record<string, Date> | null = null;
  try { times = timesFor(cur, prefs.prayerLoc, prefs.asr); } catch { times = null; }
  const nu = nextUp(day, scores, tr("pages {a}–{b}", { a: po.from, b: po.to }), (id) => !isTodayKey || !times || times[id].getTime() <= Date.now());
  const [hintSeen, setHintSeen] = useState(false);
  const t = todayKey();
  const isToday = cur === t;
  const g = greeting();
  const bd = birthday();
  const full = scores.total >= 99.95;

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const swipe = info.offset.x + info.velocity.x * 0.2;
    if (swipe > 80) shiftDay(-1);
    else if (swipe < -80 && !isToday) shiftDay(1);
    setHintSeen(true);
  };

  const ringTap = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2);
    const left = 100 - scores.total;
    toast(left <= 0.01 ? tr("Full score today. Keep it up.") : tr("{n} points still on the table.", { n: fmt(left) }));
  };

  return (
    <motion.section
      className="hero" id="hero"
      drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.18} dragSnapToOrigin onDragEnd={onDragEnd}
    >
      <div className="hero-inner">
        {bd && bd.daysTo === 0 && isToday && (
          <motion.div className="bday" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
            {tr("Happy {n} birthday{name}. May Allah bless your year.", { n: ordinal(bd.age), name: getName() ? ", " + getName() : "" })}
          </motion.div>
        )}
        <div className="greet"><h1>{g.en}</h1><div className="ar">{g.ar}</div></div>

        <div className="datenav">
          <motion.button className="navbtn" onClick={() => shiftDay(-1)} aria-label={tr("Previous day")} {...tap}>‹</motion.button>
          <AnimatePresence mode="popLayout" initial={false} custom={dir}>
            <motion.div
              key={cur} className="d" custom={dir}
              initial={{ opacity: 0, x: dir * 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -30 }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
            >
              <b>{isToday ? tr("Today") + " · " : ""}{longDate(cur)}</b>
              <span>{hijri(cur)}</span>
            </motion.div>
          </AnimatePresence>
          {!isToday && <motion.button className="todaylink" onClick={() => goTo(t)} initial={{ scale: 0 }} animate={{ scale: 1 }} {...tap}>{tr("Today")}</motion.button>}
          <motion.button className="navbtn" onClick={() => shiftDay(1)} disabled={isToday} aria-label={tr("Next day")} {...tap}>›</motion.button>
        </div>

        <div className="scoreband">
          <motion.button id="score-ring" className={`ring ${full ? "full" : ""}`} onClick={ringTap} aria-label={`Score ${Math.round(scores.total)} of 100`}
            whileTap={{ scale: 0.94 }} animate={full ? { scale: [1, 1.08, 1] } : { scale: 1 }}>
            <svg viewBox="0 0 132 132">
              {SEGMENTS.map(({ k, start, len }) => {
                const fill = Math.max(0, Math.min(1, scores[k] / MAX[k]));
                return (
                  <g key={k}>
                    <circle className="trk" cx="66" cy="66" r={R} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-start} />
                    <motion.circle className={`arc seg-${k}`} cx="66" cy="66" r={R} strokeDashoffset={-start}
                      initial={{ strokeDasharray: `0 ${C}` }}
                      animate={{ strokeDasharray: `${len * fill} ${C}`, opacity: fill > 0 ? 1 : 0 }}
                      transition={{ type: "spring", stiffness: 70, damping: 16 }} />
                  </g>
                );
              })}
            </svg>
            <div className="val"><b className="num"><AnimatedNumber value={Math.round(scores.total)} /></b><small>{tr("of 100")}</small>
              <AnimatePresence>{scores.bonus > 0 && <motion.em className="bonusval num" initial={{ scale: 0, y: 6 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0 }}>✦ +{fmt(scores.bonus)}</motion.em>}</AnimatePresence>
            </div>
          </motion.button>

          <div className="pillars">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p key={grade(scores.total)} className="grade" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18 }}>
                {grade(scores.total)}
              </motion.p>
            </AnimatePresence>
            {(Object.keys(MAX) as Pillar[]).map((k) => (
              <motion.button key={k} className={`pl pl-${k}`} onClick={() => onJump(k)} {...tap}>
                <span className="lbl"><i className={`dot seg-${k}`} />{tr(PILLAR_NAME[k])}</span>
                <Bar pct={(scores[k] / MAX[k]) * 100} max={isMax(k, scores[k])} />
                <span className="pts num">{fmt(scores[k])}/{MAX[k]}</span>
              </motion.button>
            ))}
          </div>
        </div>
        {isToday && <NextPrayerChip onOpen={() => onJump("p")} />}
        <AnimatePresence mode="wait" initial={false}>
          <motion.button key={nu.text} className="nextup" onClick={() => onJump(nu.target)}
            initial={{ opacity: 0, y: 8, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }} whileTap={{ scale: 0.97 }}>
            <span className="nu-lab">{tr("Next up")}</span>
            <span className="nu-text">{nu.text}</span>
            <motion.span className="nu-pts" animate={{ scale: [1, 1.12, 1] }} transition={{ repeat: Infinity, duration: 2, repeatDelay: 1 }}>{nu.pts}</motion.span>
          </motion.button>
        </AnimatePresence>
        {!hintSeen && <p className="swipehint">{tr("Swipe this card to change days")}</p>}
      </div>
    </motion.section>
  );
}

/** Live "next prayer" line: name, time at the chosen location, and a countdown. */
function NextPrayerChip({ onOpen }: { onOpen: () => void }) {
  const { prefs } = useStore();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 20000); return () => clearInterval(t); }, []);
  const t = todayKey();
  let np;
  try { np = nextPrayer(t, addDays(t, 1), prefs.prayerLoc, prefs.asr, now); } catch { return null; }
  const name = PRAYERS.find((p) => p.id === np.id);
  const ms = np.at.getTime() - now.getTime();
  const soon = ms < 15 * 60000;
  return (
    <motion.button className={`prayerchip ${soon ? "soon" : ""}`} onClick={onOpen} whileTap={{ scale: 0.97 }} layout>
      <span className="pc-ico" aria-hidden="true">🕌</span>
      <span className="pc-main"><b>{tr(name?.en ?? "")}</b> {tr("at")} <b className="num">{fmtTime(np.at, prefs.prayerLoc.tz)}</b></span>
      <motion.span className="pc-in num" key={Math.round(ms / 60000)} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }}>
        {tr("in {t}", { t: untilText(ms, getLang()) })}
      </motion.span>
      <span className="pc-loc">{prefs.prayerLoc.label}</span>
    </motion.button>
  );
}
