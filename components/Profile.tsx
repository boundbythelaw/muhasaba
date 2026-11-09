"use client";
import { motion } from "framer-motion";
import { useState } from "react";
import { burst, haptic, toast } from "@/lib/fx";
import { tr, type Lang } from "@/lib/i18n";
import { PRESETS } from "@/lib/prayerTimes";
import { useStore } from "@/lib/store";
import { BottomSheet } from "./Sheets";
import { Segmented, tap } from "./ui";

const LANGS: { value: Lang; label: string; sub: string }[] = [
  { value: "fr", label: "Français", sub: "🇫🇷" },
  { value: "en", label: "English", sub: "🇬🇧" },
];

/* ---------- Profile & language, in the Record tab ---------- */
export function ProfileCard() {
  const { prefs, setPrefs } = useStore();
  const [name, setName] = useState(prefs.name);
  return (
    <motion.section className="card" initial={{ opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.15 }}>
      <div className="ch"><h2>{tr("Profile & language")}</h2></div>
      <div className="lab">{tr("Language")}</div>
      <Segmented ariaLabel={tr("Language")} options={LANGS} value={prefs.lang} onSelect={(v) => { setPrefs({ lang: v }); haptic(8); }} />
      <div className="settings">
        <label>{tr("Your name")}
          <input className="inp" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onBlur={() => setPrefs({ name: name.trim() })} />
        </label>
        <label>{tr("Birthday (optional)")}
          <input className="inp" type="date" value={prefs.birth} onChange={(e) => setPrefs({ birth: e.target.value })} />
        </label>
      </div>
    </motion.section>
  );
}

/* ---------- First-run welcome for a new install ---------- */
export function Welcome() {
  const { prefs, setPrefs } = useStore();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [page, setPage] = useState("");
  const [loc, setLoc] = useState(prefs.prayerLoc.id);
  const open = !prefs.welcomed;
  const finish = (e: React.MouseEvent) => {
    const p = PRESETS.find((x) => x.id === loc) ?? prefs.prayerLoc;
    const n = parseInt(page, 10);
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    setPrefs({ name: name.trim(), basePage: isNaN(n) ? 0 : Math.max(0, Math.min(604, n)), baseDate: key, prayerLoc: p, welcomed: true });
    burst(e.clientX, e.clientY, true);
    haptic([15, 30, 15]);
    toast(name.trim() ? tr("Welcome, {name}.", { name: name.trim() }) : tr("Welcome."));
  };
  return (
    <BottomSheet open={open} onClose={() => {}} label="Welcome">
      <div className="sheet-body welcome">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="" className="wlogo" />
        {step === 0 && (
          <>
            <h3>Bienvenue · Welcome</h3>
            <p className="sheet-msg">Muhasaba — مُحاسبة. {tr("A few seconds to set it up for you.")}</p>
            <div className="lab">Langue · Language</div>
            <Segmented ariaLabel="Language" options={LANGS} value={prefs.lang} onSelect={(v) => { setPrefs({ lang: v }); haptic(8); }} />
            <motion.button className="btn big" onClick={() => setStep(1)} {...tap}>{tr("Continue")}</motion.button>
          </>
        )}
        {step === 1 && (
          <>
            <h3>{tr("What should we call you?")}</h3>
            <input className="inp big" autoFocus value={name} maxLength={40} placeholder={tr("Your first name")} onChange={(e) => setName(e.target.value)} />
            <div className="lab">{tr("Where do you pray?")}</div>
            <div className="locgrid">
              {PRESETS.map((p) => (
                <motion.button key={p.id} className={`loccity ${loc === p.id ? "on" : ""}`} onClick={() => setLoc(p.id)} {...tap}>
                  <b>{p.label}</b>
                </motion.button>
              ))}
            </div>
            <p className="sheet-msg">{tr("You can use your exact location later from the Salah card.")}</p>
            <div className="sheet-actions">
              <motion.button className="btn ghost big" onClick={() => setStep(0)} {...tap}>{tr("Back")}</motion.button>
              <motion.button className="btn big" onClick={() => setStep(2)} {...tap}>{tr("Continue")}</motion.button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <h3>{tr("Are you memorising the Qur'an?")}</h3>
            <p className="sheet-msg">{tr("Enter the last page you have memorised (1–604), and the app shows your next 2 pages each day. Leave it empty to start from the beginning.")}</p>
            <input className="inp big num" type="number" inputMode="numeric" min={0} max={604} value={page} placeholder="0" onChange={(e) => setPage(e.target.value)} />
            <div className="sheet-actions">
              <motion.button className="btn ghost big" onClick={() => setStep(1)} {...tap}>{tr("Back")}</motion.button>
              <motion.button className="btn big" onClick={finish} {...tap}>{tr("Start")}</motion.button>
            </div>
          </>
        )}
        <div className="dots" aria-hidden="true">{[0, 1, 2].map((i) => <i key={i} className={i === step ? "on" : ""} />)}</div>
      </div>
    </BottomSheet>
  );
}
