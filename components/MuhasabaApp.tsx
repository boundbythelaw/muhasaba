"use client";
import { tr } from "@/lib/i18n";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import type { Pillar } from "@/lib/constants";
import { StoreProvider, useStore } from "@/lib/store";
import { BottomNav, FxLayer, Header, MiniScore } from "./Chrome";
import { ConfirmHost, SealBanner, UnlockSheet } from "./Sheets";
import { Welcome } from "./Profile";
import Hero from "./Hero";
import QuranCard from "./QuranCard";
import JournalView from "./JournalView";
import RecordView from "./RecordView";
import SalahCard from "./SalahCard";
import WalkCard from "./WalkCard";
import BonusCard from "./BonusCard";
import WorkCard from "./WorkCard";
import CheckinCard, { CheckinNudge } from "./CheckinCard";

function ShukrCard() {
  const { day, update, locked, requestUnlock, cur } = useStore();
  return (
    <motion.section className="card" initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.15 }}>
      <div className="ch"><h2>{tr("Shukr")}<span className="ar">الشكر</span></h2></div>
      <p className="sub">{tr("One thing you're grateful for today. Not scored. It goes into your journal Doc.")}</p>
      <textarea aria-label={tr("Gratitude")} placeholder={tr("Al-ḥamdu lillāh for…")} value={day.shukr} readOnly={locked} onFocus={() => { if (locked) requestUnlock(cur); }}
        onChange={(e) => { const v = e.target.value.slice(0, 1000); update((d) => { d.shukr = v; }, null, true); }} />
    </motion.section>
  );
}

function Shell() {
  const { hydrated, view, cur, dir, shiftDay, setView } = useStore();

  // Arrow keys move between days on a keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft") shiftDay(-1);
      if (e.key === "ArrowRight") shiftDay(1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [shiftDay]);

  // Register the offline service worker in production builds.
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  if (!hydrated) {
    return (
      <div className="splash">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <motion.img src="/icon-192.png" alt="Muhasaba" animate={{ scale: [0.9, 1.05, 0.9] }} transition={{ repeat: Infinity, duration: 1.4 }} />
      </div>
    );
  }

  const jump = (p: Pillar | "journal" | "c") => {
    if (p === "journal") { setView("journal"); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    const go = () => {
      const el = document.getElementById(`sec-${p}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.remove("pulse");
      void el.offsetWidth;
      el.classList.add("pulse");
    };
    if (view !== "today") { setView("today"); setTimeout(go, 400); } else go();
  };

  return (
    <div className="wrap">
      <Header />
      <Hero onJump={jump} />
      <AnimatePresence mode="wait" initial={false} custom={dir}>
        <motion.main
          key={view === "record" ? "record" : `${view}-${cur}`} className="view"
          initial={{ opacity: 0, x: view === "record" ? 30 : dir * 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: view === "record" ? -30 : dir * -30 }}
          transition={{ type: "spring", stiffness: 360, damping: 34 }}
        >
          {view !== "record" && <SealBanner />}
          {view === "journal" ? (
            <JournalView />
          ) : view === "today" ? (
            <>
              <SalahCard />
              <QuranCard />
              <WorkCard />
              <WalkCard />
              <BonusCard />
              <CheckinCard />
              <ShukrCard />
              <p className="foot">{tr("Swipe the top card or use ‹ › to move between days. Everything saves as you tap.")}</p>
            </>
          ) : (
            <RecordView />
          )}
        </motion.main>
      </AnimatePresence>
      <MiniScore />
      <BottomNav />
      <ConfirmHost />
      <UnlockSheet />
      <Welcome />
      <CheckinNudge />
      <FxLayer />
    </div>
  );
}

export default function MuhasabaApp() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
