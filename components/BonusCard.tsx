"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { BONUS_ITEMS, BONUS_MAX, RAWATIB, RAWATIB_PTS, rakatDone, type BonusLog } from "@/lib/bonus";
import { haptic } from "@/lib/fx";
import { tr } from "@/lib/i18n";
import { fmt } from "@/lib/scoring";
import { useStore } from "@/lib/store";
import { AnimatedNumber, CheckRow, tap } from "./ui";

/** Voluntary acts. Folded by default so the page stays calm; they only ever add points. */
export default function BonusCard() {
  const { day, scores, update } = useStore();
  const [open, setOpen] = useState(false);
  const [rOpen, setROpen] = useState(false);
  const b = day.bonus;
  const rakat = rakatDone(b);
  const done = BONUS_ITEMS.filter((it) => b[it.id]);
  const set = (fn: (x: BonusLog) => void) => (e: React.MouseEvent) => update((d) => fn(d.bonus), e);

  return (
    <motion.section className={`card bonuscard ${scores.bonus > 0 ? "has" : ""}`} id="sec-b"
      initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.15 }}>
      <button className="ch cardhead" onClick={() => { setOpen(!open); haptic(6); }} aria-expanded={open}>
        <h2>✦ {tr("Bonus")}<span className="ar">النوافل</span></h2>
        <span className="headright">
          <span className="badge gold num">+<AnimatedNumber value={scores.bonus} decimals={1} /></span>
          <motion.svg className="chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" animate={{ rotate: open ? 180 : 0 }}><path d="m6 9 6 6 6-6" /></motion.svg>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div key="body" className="cardbody" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}>
            <p className="sub" style={{ marginTop: 0 }}>{tr("Extra deeds add to your day and never take anything away. They're shown next to your score, not inside the 100.")}</p>

            {/* Sunnah rawātib with their own dropdown */}
            <div className={`rawatib ${rOpen ? "open" : ""}`}>
              <button className="rhead" onClick={() => { setROpen(!rOpen); haptic(5); }} aria-expanded={rOpen}>
                <span className="rring" style={{ ["--p" as string]: rakat / 12 }}><b className="num">{rakat}</b></span>
                <span className="t">{tr("Sunnah rawātib")}<small>{tr("{n} of 12 rakʿahs", { n: rakat })}</small></span>
                <span className="p num">+{fmt((rakat / 12) * RAWATIB_PTS)}</span>
                <motion.svg className="chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" animate={{ rotate: rOpen ? 180 : 0 }}><path d="m6 9 6 6 6-6" /></motion.svg>
              </button>
              <AnimatePresence initial={false}>
                {rOpen && (
                  <motion.div className="rlist" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}>
                    <div className="row">
                      {RAWATIB.map((r) => (
                        <motion.button key={r.id} className={`pill ${b.rawatib[r.id] ? "on" : ""}`} aria-pressed={b.rawatib[r.id]} {...tap}
                          onClick={set((x) => { x.rawatib[r.id] = !x.rawatib[r.id]; })}>
                          {tr(r.label)}
                        </motion.button>
                      ))}
                    </div>
                    {rakat < 12 && (
                      <button className="linkbtn" onClick={set((x) => { for (const r of RAWATIB) x.rawatib[r.id] = true; })}>{tr("I prayed all 12")}</button>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <div className="checks">
              {BONUS_ITEMS.map((it) => (
                <CheckRow key={it.id} on={b[it.id]} title={it.label} sub={it.sub ? tr(it.sub) : it.ar} points={it.pts}
                  onToggle={set((x) => { x[it.id] = !x[it.id]; })} />
              ))}
            </div>
            <p className="note">{tr("Up to +{n} a day.", { n: BONUS_MAX })}</p>
          </motion.div>
        ) : (
          <motion.div key="sum" className="bonussum" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {done.length || rakat ? (
              <>
                {done.map((it) => <span key={it.id} className="bchip">{tr(it.label)}</span>)}
                {rakat > 0 && <span className="bchip">{tr("Rawātib")} {rakat}/12</span>}
              </>
            ) : (
              <span className="muted">{tr("Tahajjud, sunnah prayers, witr, ḍuḥā, adhkār, fasting · tap to open")}</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
