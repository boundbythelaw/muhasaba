"use client";
import { tr } from "@/lib/i18n";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { useEffect, useId, useState, type MouseEvent, type ReactNode } from "react";
import { fmt } from "@/lib/scoring";

export const tap = { whileTap: { scale: 0.95 }, transition: { type: "spring", stiffness: 500, damping: 30 } } as const;
const spring = { type: "spring", stiffness: 420, damping: 34 } as const;

/* ---------- Segmented control with a sliding highlight ---------- */
export interface SegOption<T extends string | number> {
  value: T;
  label: string;
  sub?: string;
  tone?: "top" | "bad";
}
export function Segmented<T extends string | number>({
  options, value, onSelect, ariaLabel,
}: { options: SegOption<T>[]; value: T | null | undefined; onSelect: (v: T, e: MouseEvent) => void; ariaLabel?: string }) {
  const id = useId();
  return (
    <div className="seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <motion.button
            key={String(o.value)} type="button" aria-pressed={on}
            className={`${on ? "on" : ""} ${o.tone ?? ""}`}
            onClick={(e) => onSelect(o.value, e)} {...tap}
          >
            {on && <motion.span layoutId={`seg-${id}`} className="hl" transition={spring} />}
            <span className="lbl">{tr(o.label)}{o.sub && <em>{tr(o.sub)}</em>}</span>
          </motion.button>
        );
      })}
    </div>
  );
}

/* ---------- Checklist row with a drawn checkmark ---------- */
export function CheckRow({ on, title, sub, points, onToggle }: { on: boolean; title: string; sub?: string; points: number; onToggle: (e: MouseEvent) => void }) {
  return (
    <motion.button type="button" className={`chk ${on ? "on" : ""}`} aria-pressed={on} onClick={onToggle} {...tap}>
      <motion.span className="box" animate={{ scale: on ? [1, 1.25, 1] : 1 }} transition={{ duration: 0.35 }}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
          <motion.path d="M3 8.5l3.2 3L13 4.5" initial={false} animate={{ pathLength: on ? 1 : 0 }} transition={{ duration: 0.3 }} />
        </svg>
      </motion.span>
      <span className="t">{tr(title)}{sub && <small>{sub}</small>}</span>
      <span className="p num">+{points}</span>
    </motion.button>
  );
}

export function Pill({ on, children, onClick }: { on?: boolean; children: ReactNode; onClick: (e: MouseEvent) => void }) {
  return (
    <motion.button type="button" className={`pill ${on ? "on" : ""}`} aria-pressed={!!on} onClick={onClick} {...tap}>
      {children}
    </motion.button>
  );
}

export function Badge({ value, max }: { value: number; max: number }) {
  return (
    <motion.div key={value >= max - 0.01 ? "full" : "part"} className="badge num" initial={{ scale: 0.85 }} animate={{ scale: 1 }} transition={spring}>
      <AnimatedNumber value={value} decimals={1} /> <span>/ {max}</span>
    </motion.div>
  );
}

export function CardHead({ title, ar, value, max }: { title: string; ar?: string; value: number; max: number }) {
  return (
    <div className="ch">
      <h2>{title}{ar && <span className="ar">{ar}</span>}</h2>
      <Badge value={value} max={max} />
    </div>
  );
}

/* ---------- Number that counts to its new value ---------- */
export function AnimatedNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => (decimals ? String(fmt(v)) : String(Math.round(v))));
  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const c = animate(mv, value, { duration: 0.7, ease: [0.2, 0.8, 0.2, 1] });
    return () => c.stop();
  }, [value, mv, reduce]);
  return <motion.span>{text}</motion.span>;
}

/* ---------- Animated progress bar ---------- */
export function Bar({ pct, max }: { pct: number; max?: boolean }) {
  return (
    <div className="bar">
      <motion.div className={max ? "max" : ""} initial={false} animate={{ width: `${Math.max(0, Math.min(100, pct))}%` }} transition={{ type: "spring", stiffness: 140, damping: 22 }} />
    </div>
  );
}

/* ---------- Card that eases in on scroll and folds away once complete ---------- */
export function CardShell({ id, title, ar, value, max, done, summary, children, className = "" }: {
  id: string; title: string; ar?: string; value: number; max: number; done: boolean; summary?: string; children: ReactNode; className?: string;
}) {
  // Folded only if the section was already complete when the day was opened, never mid-tap.
  const [open, setOpen] = useState(!done);
  const setManual = setOpen;
  useEffect(() => { if (!done) setOpen(true); }, [done]);
  return (
    <motion.section
      className={`card ${done ? "done" : ""} ${open ? "" : "folded"} ${className}`} id={id}
      initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.15 }}
      transition={{ type: "spring", stiffness: 260, damping: 28 }} layout="position"
    >
      <button className="ch cardhead" onClick={() => setManual(!open)} aria-expanded={open} aria-controls={`${id}-body`}>
        <h2>{tr(title)}{ar && <span className="ar">{ar}</span>}</h2>
        <span className="headright">
          <Badge value={value} max={max} />
          <motion.svg className="chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" animate={{ rotate: open ? 180 : 0 }}><path d="m6 9 6 6 6-6" /></motion.svg>
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div key="body" id={`${id}-body`} className="cardbody" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}>
            {children}
          </motion.div>
        ) : (
          <motion.p key="sum" className="donestrip" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <span className="tick">✓</span> {summary ?? tr("Complete")} <span className="muted">· {tr("tap to open")}</span>
          </motion.p>
        )}
      </AnimatePresence>
    </motion.section>
  );
}
