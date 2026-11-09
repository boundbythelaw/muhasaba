"use client";
import { loc, tr } from "@/lib/i18n";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { ask, burst, haptic, toast } from "@/lib/fx";
import { isScriptUrl, postToSheet } from "@/lib/sheetSync";
import { useStore } from "@/lib/store";
import { tap } from "./ui";

export function ago(ts: number | null, now = Date.now()) {
  if (!ts) return tr("never");
  const s = Math.round((now - ts) / 1000);
  if (s < 10) return tr("just now");
  if (s < 60) return tr("{n}s ago", { n: s });
  if (s < 3600) return tr("{n} min ago", { n: Math.floor(s / 60) });
  if (s < 86400) return tr("{n}h ago", { n: Math.floor(s / 3600) });
  return new Date(ts).toLocaleDateString(loc(), { day: "numeric", month: "short" });
}

export function statusLine(status: string, waiting: number, lastSync: number | null, now?: number) {
  switch (status) {
    case "syncing": return tr("Sending {n} day(s) to your sheet…", { n: waiting });
    case "waiting": return tr("{n} change(s) about to send", { n: waiting });
    case "offline": return tr("Offline. {n} day(s) will send when you're back online", { n: waiting });
    case "error": return tr("Couldn't send. Retrying in 30s ({n} waiting)", { n: waiting });
    default: return waiting ? tr("{n} waiting to send", { n: waiting }) : tr("Up to date · last sent {t}", { t: ago(lastSync, now) });
  }
}

const STEPS = [
  "Create a new Google Sheet (sheets.new) and name it Muhasaba.",
  "In the sheet: Extensions → Apps Script. Delete what's there, paste the Code.gs file, and save.",
  "Pick setup in the function menu, press Run, and allow access.",
  "Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone. Deploy, then copy the Web app URL.",
  "Paste that URL below and tap Connect.",
];

export default function SheetCard() {
  const { sheet, syncStatus, syncError, connectSheet, disconnectSheet, resendAll, syncNow } = useStore();
  const [url, setUrl] = useState(sheet.url);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showSteps, setShowSteps] = useState(!sheet.url);
  const [confirmOff, setConfirmOff] = useState(false);
  const [repolishing, setRepolishing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const waiting = Object.keys(sheet.pending).length;
  const connected = !!sheet.url;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  const connect = async (e: React.MouseEvent) => {
    setErr("");
    if (!isScriptUrl(url)) {
      setErr(tr("That isn't a Web app link. It should start with https://script.google.com/macros/s/ and end with /exec."));
      return;
    }
    setBusy(true);
    const res = await connectSheet(url);
    setBusy(false);
    if (res.ok) {
      burst(e.clientX, e.clientY);
      haptic([15, 30, 15]);
      toast(tr("Connected to “{s}”. Sending your history…", { s: res.sheet ?? tr("your sheet") }));
      setShowSteps(false);
    } else {
      setErr(
        res.error === "offline"
          ? tr("You're offline. Connect again once you have internet.")
          : tr("The sheet didn't answer. Check step 4: Who has access must be “Anyone”, and use the URL from the latest deployment."),
      );
    }
  };

  const dot = connected
    ? syncStatus === "error" ? "var(--warn)" : syncStatus === "offline" ? "var(--muted)" : syncStatus === "ok" || syncStatus === "idle" ? "var(--good)" : "var(--accent)"
    : "var(--line)";

  return (
    <section className="card" id="sheet-card">
      <div className="ch">
        <h2>{tr("Google Sheet")}</h2>
        <div className="badge" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <motion.i style={{ width: 8, height: 8, borderRadius: "50%", background: dot, display: "block" }}
            animate={syncStatus === "syncing" ? { scale: [1, 1.6, 1] } : { scale: 1 }} transition={{ repeat: syncStatus === "syncing" ? Infinity : 0, duration: 0.9 }} />
          {tr(connected ? "Connected" : "Not connected")}
        </div>
      </div>
      <p className="sub">{tr("Every day you log is copied to your own Google Sheet: one row per day, with scores, colours and charts.")}</p>

      {connected ? (
        <>
          <div className="sheetstatus">
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={syncStatus + waiting} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
                {statusLine(syncStatus, waiting, sheet.lastSync, now)}
              </motion.span>
            </AnimatePresence>
            {sheet.sheetName && <small>{tr("Sheet")}: {sheet.sheetName}</small>}
            {syncError && syncStatus === "error" && <small className="err">{syncError}</small>}
          </div>
          <div className="row">
            <motion.button className="btn" onClick={() => { syncNow(); haptic(8); }} disabled={!waiting} {...tap}>{tr("Send now")}</motion.button>
            <motion.button className="btn ghost" onClick={() => { resendAll(); toast(tr("Sending your full history again.")); }} {...tap}>{tr("Resend everything")}</motion.button>
            <motion.button className="btn ghost" disabled={repolishing} {...tap} onClick={async (e) => {
              const pt = { x: e.clientX, y: e.clientY };
              const ok = await ask({
                title: tr("Polish all journals again?"),
                message: tr("Every day's journal is rewritten and rated again by the AI. This uses a little of your AI credit. You only need it if you want fresh versions: ratings and links come back by themselves when days are re-sent."),
                confirmLabel: tr("Polish everything"),
                cancelLabel: tr("Cancel"),
              });
              if (!ok) return;
              setRepolishing(true);
              const r = await postToSheet(sheet.url, { repolish: true }, true) as { ok: boolean; queued?: number; done?: number; error?: string };
              setRepolishing(false);
              if (r.ok) {
                burst(pt.x, pt.y);
                const rest = Math.max(0, (r.queued ?? 0) - (r.done ?? 0));
                toast(rest ? tr("{a} polished now. The other {b} follow over the next hour.", { a: r.done ?? 0, b: rest }) : tr("{a} days polished again.", { a: r.done ?? 0 }));
              } else toast(tr("Couldn't reach your sheet. Update the script deployment (new version) and try again."));
            }}>{repolishing ? tr("Polishing…") : tr("Polish all journals again")}</motion.button>
            {!confirmOff ? (
              <motion.button className="btn ghost" onClick={() => setConfirmOff(true)} {...tap}>{tr("Disconnect")}</motion.button>
            ) : (
              <motion.button className="btn danger" onClick={() => { disconnectSheet(); setConfirmOff(false); setUrl(""); setShowSteps(true); toast(tr("Disconnected. Your sheet keeps what it has.")); }}
                initial={{ scale: 0.9 }} animate={{ scale: 1 }} {...tap}>{tr("Tap again to disconnect")}</motion.button>
            )}
          </div>
        </>
      ) : (
        <>
          <AnimatePresence initial={false}>
            {showSteps && (
              <motion.ol className="steps" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                {STEPS.map((s, i) => <li key={i}><b className="num">{i + 1}</b><span>{tr(s)}</span></li>)}
              </motion.ol>
            )}
          </AnimatePresence>
          {!showSteps && <button className="linkbtn" onClick={() => setShowSteps(true)}>{tr("Show setup steps")}</button>}
          <div className="urlrow">
            <input className="inp url" type="url" inputMode="url" autoComplete="off" spellCheck={false} placeholder={tr("https://script.google.com/macros/s/…/exec")}
              aria-label={tr("Web app URL")} value={url} onChange={(e) => { setUrl(e.target.value); setErr(""); }} />
            <motion.button className="btn" onClick={connect} disabled={busy || !url.trim()} {...tap}>{tr(busy ? "Checking…" : "Connect")}</motion.button>
          </div>
          {err && <motion.p className="err" initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: [0, -6, 6, -3, 0] }} transition={{ duration: 0.35 }}>{err}</motion.p>}
        </>
      )}
    </section>
  );
}
