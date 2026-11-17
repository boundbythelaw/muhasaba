"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { isFriday, prayerName, REASONS, reasonOf, type PrayerId } from "@/lib/constants";
import { burst, haptic, toast } from "@/lib/fx";
import { tr } from "@/lib/i18n";
import { latePoints } from "@/lib/rules";
import { excused, prayerPoints } from "@/lib/scoring";
import { useStore } from "@/lib/store";
import type { Khushu } from "@/lib/types";
import { BottomSheet } from "./Sheets";
import { tap } from "./ui";

/** Rakʿahs in each prayer (Jumuʿah has two). */
export function rakahs(id: PrayerId, date: string, gender?: string) {
  if (id === "subh") return 2;
  if (id === "maghrib") return 3;
  if (id === "dhuhr" && isFriday(date) && gender !== "f") return 2;
  return 4;
}

export const FOCUS = [
  { v: 2 as const, face: "🤲", label: "Present", sub: "with Allah most of it" },
  { v: 1 as const, face: "🌗", label: "On and off", sub: "drifted, came back" },
  { v: 0 as const, face: "💭", label: "Mostly elsewhere", sub: "my mind wandered" },
];
export const MIND = ["Work / business", "Family", "Phone / social media", "Worries", "Future plans", "Food", "Studies", "A conversation", "Nothing specific"];
export const CAUSE = ["Tired", "Rushed", "Noise / people", "Hungry", "Came in late", "Didn't prepare", "Phone just before", "Long day"];
export const BACK = [
  { v: 2 as const, label: "Straight away" },
  { v: 1 as const, label: "After a while" },
  { v: 0 as const, label: "Didn't come back" },
];

type Step = "late" | "why" | "khushu";

/**
 * After you log a prayer: a short, swipe-like series of questions.
 * Late → when did you join? · Late or no mosque → why? · Always → khushūʿ.
 */
export default function PrayerFlow({ id, start, onClose }: { id: PrayerId | null; start?: Step; onClose: () => void }) {
  const { day, update, cur, prefs } = useStore();
  const mark = id ? day.prayers[id] : undefined;
  const v2 = (day.v ?? 1) >= 2;
  const steps = useMemo<Step[]>(() => {
    if (!id) return [];
    const s: Step[] = [];
    if (mark === 1 && v2) s.push("late");
    if (mark === 0 || mark === 1) s.push("why");
    if (mark != null && day.why[id]?.r !== "period") s.push("khushu");
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, mark, v2]);
  const [i, setI] = useState(0);
  useEffect(() => { setI(start ? Math.max(0, steps.indexOf(start)) : 0); }, [id, start, steps]);
  const step = steps[i];
  const p = id ? prayerName(id, cur, prefs.gender) : null;
  const next = () => {
    haptic(6);
    if (i < steps.length - 1) setI(i + 1);
    else {
      onClose();
      if (id && day.prayers[id] === 2 && day.khushu[id]?.f === 2) {
        burst(innerWidth / 2, innerHeight * 0.4);
        toast(tr("Before the takbīr and present with Allah. Mā shāʾ Allāh."));
      }
    }
  };
  const back = () => setI((x) => Math.max(0, x - 1));

  return (
    <BottomSheet open={!!id && steps.length > 0} onClose={onClose} label={p ? tr(p.en) : ""}>
      {id && p && step && (
        <div className="sheet-body flow">
          <div className="flowtop">
            <span className="flowname">{tr(p.en)} <span className="ar">{p.ar}</span></span>
            <span className="flowpts num">{prayerPoints(day, id)} / 8</span>
          </div>
          <div className="flowdots">{steps.map((s, k) => <i key={s} className={k === i ? "on" : k < i ? "done" : ""} />)}</div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={step} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }} transition={{ type: "spring", stiffness: 380, damping: 34 }}>
              {step === "late" && <LateStep id={id} onPicked={next} />}
              {step === "why" && <WhyStep id={id} />}
              {step === "khushu" && <KhushuStep id={id} />}
            </motion.div>
          </AnimatePresence>
          <div className="flownav">
            {i > 0 ? <motion.button className="btn ghost" {...tap} onClick={back}>{tr("Back")}</motion.button> : <span />}
            <motion.button className="btn big" {...tap} onClick={next}>
              {i < steps.length - 1 ? tr("Next") : tr("Done")}
            </motion.button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

function LateStep({ id, onPicked }: { id: PrayerId; onPicked: () => void }) {
  const { day, update, cur, prefs } = useStore();
  const of = rakahs(id, cur, prefs.gender);
  const l = day.late[id];
  const opts = Array.from({ length: of }, (_, m) => ({ m, label: m === 0 ? tr("Right after the takbīr") : tr("Missed {n} rakʿah", { n: m }), pts: latePoints({ m, of }) }));
  return (
    <div>
      <h3>{tr("When did you join?")}</h3>
      <p className="sheet-msg">{tr("Missing more than half the rakʿahs counts as a missed jamāʿah.")}</p>
      <div className="lateopts">
        {opts.map((o) => (
          <motion.button key={o.m} {...tap} className={`lateopt ${l?.m === o.m ? "on" : ""} ${o.pts === 0 ? "zero" : ""}`}
            onClick={(e) => { void update((d) => { d.late[id] = { m: o.m, of }; }, e, false, { noConfirm: true }).then((ok) => { if (ok) setTimeout(onPicked, 250); }); }}>
            <span className="rk" aria-hidden="true">{Array.from({ length: of }, (_, k) => <i key={k} className={k < o.m ? "miss" : ""} />)}</span>
            <b>{o.label}</b>
            <em className="num">{o.pts}</em>
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function WhyStep({ id }: { id: PrayerId }) {
  const { day, update, prefs, cur } = useStore();
  const w = day.why[id];
  const r = reasonOf(w?.r);
  const p = prayerName(id, cur, prefs.gender);
  const list = REASONS.filter((x) => !x.women || prefs.gender === "f");
  const set = (rid: (typeof REASONS)[number]["id"]) => update((d) => {
    if (d.why[id]?.r === rid) delete d.why[id];
    else d.why[id] = { r: rid, ok: rid === "period" ? true : undefined };
  }, null, true, { noConfirm: true });
  return (
    <div>
      <h3>{day.prayers[id] === 1 ? tr("Why were you late for {p}?", { p: tr(p.en) }) : tr("Why weren't you at the mosque for {p}?", { p: tr(p.en) })}</h3>
      <div className="lab">{tr("Valid excuses")}</div>
      <div className="whychips">
        {list.filter((x) => x.excuse).map((x) => (
          <motion.button key={x.id} {...tap} className={`whychip ex ${w?.r === x.id ? "on" : ""}`} onClick={() => { set(x.id); haptic(6); }}>{tr(x.label)}</motion.button>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {r?.excuse && (
          <motion.div className="whyok" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            {r.okLabel ? (
              <motion.button {...tap} className={`whytick ${w?.ok ? "on" : ""}`}
                onClick={(e) => update((d) => { const x = d.why[id]; if (x) x.ok = !x.ok; }, e, false, { noConfirm: true })}>
                <i>{w?.ok ? "✓" : ""}</i><span>{tr(r.okLabel)}</span><b>{w?.ok ? tr("Excused · 8") : "+8"}</b>
              </motion.button>
            ) : (
              <p className="note">{tr("You're not required to pray. It counts as full, in shāʾ Allāh.")}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <div className="lab">{tr("Other reasons")}</div>
      <div className="whychips">
        {list.filter((x) => !x.excuse).map((x) => (
          <motion.button key={x.id} {...tap} className={`whychip ${w?.r === x.id ? "on" : ""} ${x.id === "nature" ? "half" : ""}`} onClick={() => { set(x.id); haptic(6); }}>
            {tr(x.label)}{x.id === "nature" && (day.v ?? 1) >= 2 ? ` · ${day.prayers[id] === 1 ? 6 : 4}` : ""}
          </motion.button>
        ))}
      </div>
      {excused(w) && <p className="note good">{tr("Counted as a full 8.")}</p>}
    </div>
  );
}

function KhushuStep({ id }: { id: PrayerId }) {
  const { day, update } = useStore();
  const k: Khushu | undefined = day.khushu[id];
  const set = (fn: (k: Khushu) => void) => update((d) => {
    const x = d.khushu[id] ?? { f: 2, what: [], why: [], back: null };
    fn(x);
    d.khushu[id] = x;
  }, null, true, { noConfirm: true });
  const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <div>
      <h3>{tr("How was your khushūʿ?")}</h3>
      <div className="focusopts">
        {FOCUS.map((f) => (
          <motion.button key={f.v} {...tap} className={`focusopt f${f.v} ${k?.f === f.v ? "on" : ""}`}
            onClick={() => { void set((x) => { x.f = f.v; if (f.v === 2) { x.what = []; x.why = []; x.back = null; } }); haptic(10); }}>
            <span>{f.face}</span><b>{tr(f.label)}</b><small>{tr(f.sub)}</small>
          </motion.button>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {k && k.f < 2 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} style={{ overflow: "hidden" }}>
            <div className="lab">{tr("What took your mind away?")}</div>
            <div className="whychips">
              {MIND.map((m) => <motion.button key={m} {...tap} className={`whychip ${k.what.includes(m) ? "on" : ""}`} onClick={() => { void set((x) => { x.what = toggle(x.what, m); }); haptic(5); }}>{tr(m)}</motion.button>)}
            </div>
            <div className="lab">{tr("Why, do you think?")}</div>
            <div className="whychips">
              {CAUSE.map((m) => <motion.button key={m} {...tap} className={`whychip ${k.why.includes(m) ? "on" : ""}`} onClick={() => { void set((x) => { x.why = toggle(x.why, m); }); haptic(5); }}>{tr(m)}</motion.button>)}
            </div>
            <div className="lab">{tr("When you noticed, how fast did you come back?")}</div>
            <div className="backopts">
              {BACK.map((b) => <motion.button key={b.v} {...tap} className={k.back === b.v ? "on" : ""} onClick={() => { void set((x) => { x.back = x.back === b.v ? null : b.v; }); haptic(5); }}>{tr(b.label)}</motion.button>)}
            </div>
            <NoteBox value={k.note ?? ""} onSave={(t) => set((x) => { x.note = t || undefined; })} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NoteBox({ value, onSave }: { value: string; onSave: (t: string) => void }) {
  const [t, setT] = useState(value);
  useEffect(() => setT(value), [value]);
  return (
    <textarea className="inp flownote" rows={2} placeholder={tr("Anything else? (optional)")} value={t}
      onChange={(e) => setT(e.target.value)} onBlur={() => { if (t.trim() !== value) onSave(t.trim()); }} />
  );
}
