"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isFriday } from "@/lib/constants";
import { burst, haptic, useBackClose } from "@/lib/fx";
import { num, tr } from "@/lib/i18n";
import { useStore } from "@/lib/store";
import { CardShell, tap } from "./ui";

/** Friday: ṣalawāt on the Prophet ﷺ. Other days: the two tasbīḥ "heavy on the scale". */
const PHRASES = {
  salawat: {
    ar: "اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَى نَبِيِّنَا مُحَمَّدٍ",
    tl: "Allāhumma ṣalli wa sallim ʿalā nabiyyinā Muḥammad",
    why: "“Increase your ṣalāh upon me on Friday.” (Abū Dāwūd)",
  },
  tasbih: {
    ar: "سُبْحَانَ اللَّهِ الْعَظِيمِ، سُبْحَانَ اللَّهِ وَبِحَمْدِهِ",
    tl: "Subḥān Allāhi l-ʿAẓīm, subḥān Allāhi wa bi-ḥamdih",
    why: "“Two words light on the tongue, heavy on the scale, beloved to the Most Merciful.” (al-Bukhārī)",
  },
} as const;
const MARKS = [33, 100, 300, 500, 1000];

/**
 * Dhikr counter. The card shows today's count; "Start counting" opens a full-screen counter where a tap
 * anywhere adds one, so you can count while you say it. The screen stays on while it's open.
 */
export default function DhikrCard() {
  const { day, cur } = useStore();
  const kind = isFriday(cur) ? "salawat" : "tasbih";
  const n = day.dhikr[kind];
  const [open, setOpen] = useState(false);
  const P = PHRASES[kind];
  return (
    <CardShell id="sec-d" title={tr("Dhikr")} ar="الذكر" value={n} max={0} done={false}
      pending={`${num(n)} × ${kind === "salawat" ? tr("ṣalawāt") : tr("tasbīḥ")}`}
      badge={<motion.span className="badge num" key={n} initial={{ scale: 0.85 }} animate={{ scale: 1 }}>{num(n)}</motion.span>}>
      <p className="dk-ar ar">{P.ar}</p>
      <p className="dk-tl">{P.tl}</p>
      <p className="note">{tr(P.why)}</p>
      <motion.button className="dk-start" whileTap={{ scale: 0.97 }} onClick={() => { setOpen(true); haptic(10); }}>
        <span className="dk-count num">{num(n)}</span>
        <span><b>{tr("Start counting")}</b><small>{tr("Tap anywhere on the screen each time you say it")}</small></span>
      </motion.button>
      <AnimatePresence>{open && <CountMode kind={kind} onClose={() => setOpen(false)} />}</AnimatePresence>
    </CardShell>
  );
}

function CountMode({ kind, onClose }: { kind: "salawat" | "tasbih"; onClose: () => void }) {
  const { day, update } = useStore();
  const saved = day.dhikr[kind];
  const [n, setN] = useState(saved);
  const [pulse, setPulse] = useState(0);
  const pending = useRef(saved);
  const P = PHRASES[kind];
  useBackClose(true, onClose);

  // Save at most once a second while counting, and when closing.
  const flush = useCallback(() => {
    const v = pending.current;
    void update((d) => { d.dhikr[kind] = v; }, null, true, { noConfirm: true });
  }, [kind, update]);
  useEffect(() => {
    const t = setInterval(() => { if (pending.current !== saved) flush(); }, 1000);
    return () => { clearInterval(t); flush(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the screen on while counting.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => undefined);
    return () => { void lock?.release().catch(() => undefined); };
  }, []);

  const add = (e: React.PointerEvent) => {
    const v = n + 1;
    setN(v);
    pending.current = v;
    setPulse((p) => p + 1);
    if (MARKS.includes(v)) { haptic([30, 40, 30]); burst(e.clientX, e.clientY); } else haptic(8);
  };
  const undo = (e: React.MouseEvent) => { e.stopPropagation(); const v = Math.max(0, n - 1); setN(v); pending.current = v; haptic(4); };
  const next = MARKS.find((m) => m > n) ?? Math.ceil((n + 1) / 1000) * 1000;
  const prev = [...MARKS].reverse().find((m) => m <= n) ?? 0;
  const pct = (n - prev) / (next - prev);

  if (typeof document === "undefined") return null;
  return createPortal(
    <motion.div className="countmode" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={add} role="button" aria-label={tr("Count one")}>
      <button className="lbx" onPointerDown={(e) => e.stopPropagation()} onClick={onClose} aria-label={tr("Close")}>×</button>
      <div className="cm-top">
        <p className="cm-ar ar">{P.ar}</p>
        <p className="cm-tl">{P.tl}</p>
      </div>
      <div className="cm-mid">
        <AnimatePresence>
          <motion.span key={pulse} className="cm-ripple" initial={{ scale: 0.6, opacity: 0.45 }} animate={{ scale: 1.9, opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.7 }} />
        </AnimatePresence>
        <svg className="cm-ring" viewBox="0 0 200 200" aria-hidden="true">
          <circle cx="100" cy="100" r="90" className="cm-bg" />
          <motion.circle cx="100" cy="100" r="90" className="cm-fg" initial={false} animate={{ pathLength: pct }} transition={{ type: "spring", stiffness: 200, damping: 24 }} style={{ rotate: -90, transformOrigin: "50% 50%" }} />
        </svg>
        <motion.b className="cm-n num" key={n} initial={{ scale: 0.92 }} animate={{ scale: 1 }}>{num(n)}</motion.b>
        <span className="cm-next num">{tr("next: {n}", { n: num(next) })}</span>
      </div>
      <div className="cm-foot">
        <button className="btn ghost light" onPointerDown={(e) => e.stopPropagation()} onClick={undo}>−1</button>
        <span>{tr("Tap anywhere")}</span>
        <button className="btn light" onPointerDown={(e) => e.stopPropagation()} onClick={onClose}>{tr("Done")}</button>
      </div>
    </motion.div>,
    document.body,
  );
}
