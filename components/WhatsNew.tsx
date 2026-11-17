"use client";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { tr } from "@/lib/i18n";
import { RULES, UPDATES } from "@/lib/rules";
import { useStore } from "@/lib/store";
import { BottomSheet } from "./Sheets";
import { Disclose, tap } from "./ui";

/** Shown once after a major update: what's new and what changed in the scoring. */
export default function WhatsNew() {
  const { prefs, setPrefs, hydrated } = useStore();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (hydrated && prefs.welcomed && (prefs.seenUpdate ?? 1) < RULES) setOpen(true);
  }, [hydrated, prefs.welcomed, prefs.seenUpdate]);
  const u = UPDATES[0];
  const close = () => { setOpen(false); setPrefs({ seenUpdate: RULES }); };
  return (
    <BottomSheet open={open} onClose={close} label={tr("What's new")}>
      <div className="sheet-body">
        <div className="lab">{tr("Major update · v{v}", { v: u.v })}</div>
        <h3>{tr(u.title)}</h3>
        <ul className="newlist">
          {u.changes.map((c, i) => (
            <motion.li key={c} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i }}>{tr(c)}</motion.li>
          ))}
        </ul>
        <div className="lab">{tr("Scoring")}</div>
        <ul className="newlist small">{u.scoring.map((c) => <li key={c}>{tr(c)}</li>)}</ul>
        <motion.button className="btn big" {...tap} onClick={close}>{tr("Bismillāh")}</motion.button>
      </div>
    </BottomSheet>
  );
}

/** The full history of major updates, for the Record tab. */
export function UpdatesCard() {
  return (
    <section className="card">
      <div className="ch"><h2>{tr("Updates")}</h2><span className="lab">v{RULES}</span></div>
      <p className="sub">{tr("Each day keeps the rules it was logged with, so an update never changes an old score.")}</p>
      {UPDATES.map((u) => (
        <Disclose key={u.v} label={`v${u.v} · ${u.date} · ${tr(u.title)}`}>
          <ul className="newlist small">{u.changes.map((c) => <li key={c}>{tr(c)}</li>)}</ul>
          <div className="lab">{tr("Scoring")}</div>
          <ul className="newlist small">{u.scoring.map((c) => <li key={c}>{tr(c)}</li>)}</ul>
        </Disclose>
      ))}
    </section>
  );
}
