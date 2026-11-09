"use client";
import { loc, num, tr } from "@/lib/i18n";
import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { STEP_GOAL } from "@/lib/constants";
import { longDate } from "@/lib/dates";
import { haptic, subscribeAsk, toast, type AskRequest } from "@/lib/fx";
import { countWords, UNLOCK_MINUTES, UNLOCK_WORDS } from "@/lib/guard";
import { useStore } from "@/lib/store";
import { tap } from "./ui";

/* ---------- Bottom sheet: slides up, drag down or tap outside to close ---------- */
export function BottomSheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="sheet-backdrop" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            className="sheet" role="dialog" aria-modal="true" aria-label={tr(label)}
            initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 420, damping: 38 }}
            drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0.05, bottom: 0.6 }}
            onDragEnd={(_: unknown, i: PanInfo) => { if (i.offset.y > 110 || i.velocity.y > 600) onClose(); }}
          >
            <div className="sheet-grip" aria-hidden="true" />
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ---------- "Change what you logged?" ---------- */
export function ConfirmHost() {
  const [req, setReq] = useState<AskRequest | null>(null);
  useEffect(() => subscribeAsk((r) => setReq((cur) => { cur?.resolve(false); return r; })), []);
  const close = (ok: boolean) => {
    if (!req) return;
    req.resolve(ok);
    haptic(ok ? [12, 30, 12] : 6);
    setReq(null);
  };
  return (
    <BottomSheet open={!!req} onClose={() => close(false)} label={req?.title ?? "Confirm"}>
      {req && (
        <div className="sheet-body">
          <div className="sheet-icon warn" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
          </div>
          <h3>{req.title}</h3>
          {req.message && <p className="sheet-msg">{req.message}</p>}
          {req.lines && (
            <ul className="changes">
              {req.lines.map((l, i) => (
                <motion.li key={i} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}>{l}</motion.li>
              ))}
            </ul>
          )}
          <div className="sheet-actions">
            <motion.button className="btn ghost big" onClick={() => close(false)} {...tap}>{req.cancelLabel ?? tr("Cancel")}</motion.button>
            <motion.button className="btn big" onClick={() => close(true)} {...tap}>{req.confirmLabel ?? tr("Confirm")}</motion.button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

/* ---------- Unlock a sealed day ---------- */
export function UnlockSheet() {
  const { unlockFor, requestUnlock, unlockDay } = useStore();
  const [text, setText] = useState("");
  useEffect(() => { if (unlockFor) setText(""); }, [unlockFor]);
  const n = countWords(text);
  const pct = Math.min(n / UNLOCK_WORDS, 1);
  const done = n >= UNLOCK_WORDS;
  return (
    <BottomSheet open={!!unlockFor} onClose={() => requestUnlock(null)} label="Unlock this day">
      {unlockFor && (
        <div className="sheet-body">
          <motion.div className="sheet-icon lock" aria-hidden="true" animate={{ rotate: [0, -8, 8, -4, 0] }} transition={{ duration: 0.5 }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><rect x="4" y="10" width="16" height="11" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
          </motion.div>
          <h3>{tr("{day} is sealed", { day: longDate(unlockFor) })}</h3>
          <p className="sheet-msg">
            {tr("Days older than 3 days are locked so a slip of the finger can't change them. To reopen it for {m} minutes, write at least {w} words on what you're correcting and why. Your reason is saved with the day.", { m: UNLOCK_MINUTES, w: UNLOCK_WORDS })}
          </p>
          <textarea className="jtext" rows={6} value={text} onChange={(e) => setText(e.target.value)} aria-label={tr("Reason for changing this day")}
            placeholder={tr("I'm correcting… because…")} />
          <div className="wordmeter">
            <div className="bar"><motion.div className={done ? "max" : ""} animate={{ width: `${pct * 100}%` }} transition={{ type: "spring", stiffness: 200, damping: 24 }} /></div>
            <span className="num">{tr("{n} / {w} words", { n, w: UNLOCK_WORDS })}</span>
          </div>
          <div className="sheet-actions">
            <motion.button className="btn ghost big" onClick={() => requestUnlock(null)} {...tap}>{tr("Keep it sealed")}</motion.button>
            <motion.button className="btn big" disabled={!done} {...tap}
              onClick={() => { if (unlockDay(unlockFor, text)) { haptic([15, 40, 15]); toast(tr("Unlocked for {n} minutes.", { n: UNLOCK_MINUTES })); } }}>
              {tr("Unlock")}
            </motion.button>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}

/* ---------- Steps editor ---------- */
export function StepsSheet({ open, onClose, value, onSave }: { open: boolean; onClose: () => void; value: number | null; onSave: (n: number | null) => void }) {
  const [n, setN] = useState(value ?? 0);
  useEffect(() => { if (open) setN(value ?? 0); }, [open, value]);
  const bump = (d: number) => { setN((x) => Math.max(0, Math.min(100000, x + d))); haptic(5); };
  return (
    <BottomSheet open={open} onClose={onClose} label="Edit steps">
      <div className="sheet-body">
        <h3>{tr("Steps today")}</h3>
        <div className="stepsedit">
          <motion.button className="sb" onClick={() => bump(-500)} aria-label={tr("500 fewer")} {...tap}>−</motion.button>
          <input className="stepsinput num" type="number" inputMode="numeric" min={0} step={100} value={n || ""} placeholder="0"
            onChange={(e) => setN(Math.max(0, Math.min(100000, parseInt(e.target.value, 10) || 0)))} aria-label={tr("Steps")} />
          <motion.button className="sb" onClick={() => bump(500)} aria-label={tr("500 more")} {...tap}>+</motion.button>
        </div>
        <p className={`sheet-msg center ${n >= STEP_GOAL ? "ok" : ""}`}>{n >= STEP_GOAL ? tr("Minimum met ✓") : tr("{n} to reach 8,000", { n: num(STEP_GOAL - n) })}</p>
        <div className="row center">
          {[4000, 6000, 8000, 10000, 12000, 15000].map((p) => (
            <motion.button key={p} className={`pill ${n === p ? "on" : ""}`} onClick={() => { setN(p); haptic(5); }} {...tap}>{p / 1000}k</motion.button>
          ))}
        </div>
        <div className="sheet-actions">
          <motion.button className="btn ghost big" onClick={onClose} {...tap}>{tr("Cancel")}</motion.button>
          <motion.button className="btn big" onClick={() => { onSave(n || null); onClose(); }} {...tap}>{tr("Save")}</motion.button>
        </div>
      </div>
    </BottomSheet>
  );
}

/* ---------- Banner shown on sealed days ---------- */
export function SealBanner() {
  const { locked, cur, requestUnlock, day, unlockedUntil } = useStore();
  const until = unlockedUntil[cur];
  const open = !locked && until && until > Date.now();
  if (!locked && !open) return null;
  return (
    <motion.div className={`seal ${locked ? "" : "open"}`} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} layout>
      <span className="seal-ico" aria-hidden="true">{locked ? "🔒" : "🔓"}</span>
      <div>
        <b>{locked ? tr("This day is sealed") : tr("Unlocked for corrections")}</b>
        <span>{locked ? tr("Days older than 3 days can't be changed by accident.") : tr("Locks again at {t}.", { t: new Date(until!).toLocaleTimeString(loc(), { hour: "2-digit", minute: "2-digit" }) })}
          {day.unlocks?.length ? " " + tr("Reopened {n}× before.", { n: day.unlocks.length }) : ""}</span>
      </div>
      {locked && <motion.button className="btn" onClick={() => requestUnlock(cur)} {...tap}>{tr("Unlock")}</motion.button>}
    </motion.div>
  );
}
