"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { isJumuah, prayerName, PRAYERS, REASONS, reasonOf, type PrayerId } from "@/lib/constants";
import { excused, prayerPoints } from "@/lib/scoring";
import PrayerFlow, { FOCUS } from "./PrayerFlow";
import { todayKey } from "@/lib/dates";
import { haptic, toast } from "@/lib/fx";
import { getLang, getName, tr } from "@/lib/i18n";
import { currentPrayer, fmtTime, METHOD_NAME, PRESETS, resolveMethod, timesFor, untilText, type MethodId, type PrayerLocation } from "@/lib/prayerTimes";
import { useStore } from "@/lib/store";
import type { PrayerMark } from "@/lib/types";
import { BottomSheet } from "./Sheets";
import { CardShell, Segmented, tap } from "./ui";

const MARKS = [
  { v: 2 as PrayerMark, label: "Before takbīr", jlabel: "Before the khuṭbah", sub: "8", tone: "top" },
  { v: 1 as PrayerMark, label: "Late", jlabel: "Late", sub: "6 · 4 · 2 · 0", tone: "mid" },
  { v: 0 as PrayerMark, label: "Not at the mosque", jlabel: "Missed Jumuʿah", sub: "0", tone: "bad" },
];

/**
 * Salah, one prayer at a time: a strip of the five prayers, and the one that needs you now in focus.
 * Logging opens a short step-by-step popup (when you joined, why, khushūʿ).
 */
export default function SalahCard() {
  const { day, scores, update, cur, prefs } = useStore();
  const [locOpen, setLocOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  const early = PRAYERS.filter(({ id }) => day.prayers[id] === 2).length;
  const isToday = cur === todayKey();
  let times: ReturnType<typeof timesFor> | null = null;
  try { times = timesFor(cur, prefs.prayerLoc, prefs.asr); } catch { times = null; }
  const live = isToday && times ? currentPrayer(times, now) : null;
  const next = isToday && times ? PRAYERS.find(({ id }) => times![id].getTime() > now.getTime())?.id : undefined;
  const tz = prefs.prayerLoc.tz;
  const started = (id: PrayerId) => !isToday || !times || times[id].getTime() <= now.getTime();
  // The prayer that needs you: the first one whose time came and isn't logged; else the next one; else Isha.
  const auto = PRAYERS.find(({ id }) => day.prayers[id] == null && !day.why[id] && started(id))?.id ?? next ?? "isha";
  const [sel, setSel] = useState<PrayerId | null>(null);
  useEffect(() => setSel(null), [cur]);
  const focus = sel ?? auto;
  const [flow, setFlow] = useState<{ id: PrayerId; start?: "late" | "why" | "khushu" } | null>(null);
  const v2 = (day.v ?? 1) >= 2;

  const { en, ar } = prayerName(focus, cur, prefs.gender);
  const jumuah = isJumuah(focus, cur, prefs.gender);
  const at = times?.[focus];
  const mark = day.prayers[focus];
  const w = day.why[focus];
  const r = reasonOf(w?.r);
  const k = day.khushu[focus];

  const pick = (v: PrayerMark, e: React.MouseEvent) => {
    const id = focus;
    void update((d) => {
      if (d.prayers[id] === v) { delete d.prayers[id]; delete d.why[id]; delete d.late[id]; delete d.khushu[id]; return; }
      d.prayers[id] = v;
      if (v === 2) { delete d.why[id]; delete d.late[id]; }
      if (v === 0) delete d.late[id];
    }, e).then((ok) => {
      if (!ok || day.prayers[id] === v) return;
      haptic(v === 2 ? 18 : 8);
      setFlow({ id });
    });
  };

  return (
    <CardShell id="sec-p" title="Salah" ar="الصلاة" value={scores.p} max={40} done={scores.p >= 40} startOpen
      summary={tr("All five in jamāʿah before the takbīr")}
      pending={tr("{n} of 5 logged", { n: PRAYERS.filter(({ id }) => day.prayers[id] != null || excused(day.why[id])).length })}>
      <div className="pstrip" role="tablist">
        {PRAYERS.map(({ id }) => {
          const n = prayerName(id, cur, prefs.gender);
          const m = day.prayers[id];
          const ex = excused(day.why[id]);
          const t = times?.[id];
          return (
            <motion.button key={id} role="tab" aria-selected={focus === id} {...tap}
              className={`pchip ${focus === id ? "sel" : ""} ${ex ? "ex" : m === 2 ? "top" : m === 1 ? "mid" : m === 0 ? "bad" : started(id) && isToday ? "due" : ""} ${live === id ? "live" : ""}`}
              onClick={() => { setSel(id); haptic(5); }}>
              <span className="pc-n">{live === id && <i className="pc-live" aria-label={tr("now")} />}{tr(n.en)}</span>
              <span className="pc-t num">{t ? fmtTime(t, tz) : ""}</span>
              <span className="pc-s num">{m == null && !ex ? (live === id ? "●" : "–") : prayerPoints(day, id)}</span>
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={focus + cur} className={`pfocus ${live === focus ? "live" : ""}`}
          initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }} transition={{ type: "spring", stiffness: 380, damping: 30 }}>
          <div className="pf-head">
            <div>
              <h3>{tr(en)} <span className="ar">{ar}</span></h3>
              <span className="pf-time num">
                {at ? fmtTime(at, tz) : ""}
                {live === focus && <em className="tag now">{tr("now")}</em>}
                {next === focus && at && <em className="tag soon">{tr("in {t}", { t: untilText(at.getTime() - now.getTime(), getLang()) })}</em>}
              </span>
            </div>
            <motion.div className="pf-pts num" key={prayerPoints(day, focus)} initial={{ scale: 0.7 }} animate={{ scale: 1 }}>
              {prayerPoints(day, focus)}<small>/8</small>
            </motion.div>
          </div>
          <div className="pf-marks">
            {MARKS.map((o) => (
              <motion.button key={o.v} {...tap} className={`pf-mark ${o.tone} ${mark === o.v ? "on" : ""}`} onClick={(e) => pick(o.v, e)}>
                <b>{tr(jumuah ? o.jlabel : o.label)}</b>
                <small className="num">{o.v === 1 && !v2 ? "4" : o.sub}</small>
              </motion.button>
            ))}
          </div>
          {(mark != null || w) && (
            <div className="pf-info">
              {mark === 1 && v2 && (
                <button className="pf-tag" onClick={() => setFlow({ id: focus, start: "late" })}>
                  {day.late[focus] ? (day.late[focus]!.m === 0 ? tr("Right after the takbīr") : tr("Missed {n} rakʿah", { n: day.late[focus]!.m })) : tr("+ When did you join?")}
                </button>
              )}
              {(mark === 0 || mark === 1 || w) && (
                <button className={`pf-tag ${r?.excuse ? (excused(w) ? "ex" : "warn") : ""}`} onClick={() => setFlow({ id: focus, start: "why" })}>
                  {r ? `${tr(r.label)}${excused(w) ? " ✓" : ""}` : tr("+ Why?")}
                </button>
              )}
              {mark != null && w?.r !== "period" && (
                <button className={`pf-tag k${k?.f ?? ""}`} onClick={() => setFlow({ id: focus, start: "khushu" })}>
                  {k ? `${FOCUS.find((f) => f.v === k.f)!.face} ${tr(FOCUS.find((f) => f.v === k.f)!.label)}` : tr("+ Khushūʿ")}
                </button>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <motion.button className="locbar" onClick={() => { setLocOpen(true); haptic(6); }} whileTap={{ scale: 0.98 }}>
        <span aria-hidden="true">📍</span>
        <b>{prefs.prayerLoc.label}</b>
        <span className="muted">{METHOD_NAME[resolveMethod(prefs.prayerLoc)]}{times ? ` · ${tr("Sunrise")} ${fmtTime(times.sunrise, tz)}` : ""}</span>
        <span className="change">{tr("Change")}</span>
      </motion.button>

      <PrayerFlow id={flow?.id ?? null} start={flow?.start} onClose={() => setFlow(null)} />

      <AnimatePresence>
        {early === 5 && (
          <motion.div className="jamaah" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
            ✦ {tr("All five in jamāʿah before the takbīr. Mā shāʾ Allāh")}{getName() ? `, ${getName()}` : ""}.
          </motion.div>
        )}
      </AnimatePresence>
      <LocationSheet open={locOpen} onClose={() => setLocOpen(false)} />
    </CardShell>
  );
}

/* ---------- Choose where prayer times are calculated ---------- */
function LocationSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { prefs, setPrefs } = useStore();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const cur = prefs.prayerLoc;
  const today = todayKey();
  let t: ReturnType<typeof timesFor> | null = null;
  try { t = timesFor(today, cur, prefs.asr); } catch { t = null; }

  const pick = (loc: PrayerLocation) => {
    setPrefs({ prayerLoc: { ...loc, method: cur.id === loc.id ? cur.method : "auto" } });
    haptic(10);
    toast(tr("Prayer times for {city}", { city: loc.label }));
  };
  const useGps = () => {
    setErr("");
    if (!navigator.geolocation) { setErr(tr("Location isn't available on this device.")); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        const city = tz.split("/").pop()?.replace(/_/g, " ") || tr("My location");
        pick({ id: "gps", label: `${city} (GPS)`, lat: pos.coords.latitude, lng: pos.coords.longitude, tz, method: "auto" });
      },
      () => { setBusy(false); setErr(tr("Location was refused. Allow it in your browser settings, or pick a city above.")); },
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 600000 },
    );
  };
  const methods: (MethodId | "auto")[] = ["auto", "mwl", "ummalqura", "egypt", "france12", "isna"];

  return (
    <BottomSheet open={open} onClose={onClose} label="Prayer times">
      <div className="sheet-body">
        <h3>{tr("Prayer times")}</h3>
        <div className="locgrid">
          {PRESETS.map((p) => (
            <motion.button key={p.id} className={`loccity ${cur.id === p.id ? "on" : ""}`} onClick={() => pick(p)} {...tap}>
              <span aria-hidden="true">{p.id === "makkah" ? "🕋" : p.id === "madinah" ? "🕌" : p.id === "brussels" ? "🇧🇪" : "🇬🇳"}</span>
              <b>{p.label}</b>
            </motion.button>
          ))}
        </div>
        <motion.button className={`btn ghost big ${cur.id === "gps" ? "gpson" : ""}`} onClick={useGps} disabled={busy} {...tap}>
          {busy ? <span className="spinner" aria-hidden="true" /> : "📍 "}{cur.id === "gps" ? tr("Update my location") : tr("Use my current location")}
        </motion.button>
        {err && <p className="err">{err}</p>}

        {t && (
          <div className="timetable">
            {(["subh", "sunrise", "dhuhr", "asr", "maghrib", "isha"] as const).map((k) => (
              <div key={k} className={k === "sunrise" ? "sr" : ""}>
                <span>{tr(k === "sunrise" ? "Sunrise" : PRAYERS.find((p) => p.id === k)!.en)}</span>
                <b className="num">{fmtTime(t![k], cur.tz)}</b>
              </div>
            ))}
          </div>
        )}

        <div className="lab">{tr("Asr time")}</div>
        <Segmented ariaLabel={tr("Asr time")} value={prefs.asr}
          options={[{ value: "standard", label: "Standard", sub: "Shāfiʿī · Mālikī · Ḥanbalī" }, { value: "hanafi", label: "Ḥanafī", sub: tr("later") }]}
          onSelect={(v) => { setPrefs({ asr: v as "standard" | "hanafi" }); haptic(8); }} />

        <div className="lab">{tr("Calculation method")}</div>
        <div className="row">
          {methods.map((m) => (
            <motion.button key={m} className={`pill ${cur.method === m ? "on" : ""}`} {...tap}
              onClick={() => { setPrefs({ prayerLoc: { ...cur, method: m } }); haptic(6); }}>
              {m === "auto" ? `${tr("Automatic")} · ${METHOD_NAME[resolveMethod({ ...cur, method: "auto" })]}` : METHOD_NAME[m]}
            </motion.button>
          ))}
        </div>
        <p className="sheet-msg">{tr("Times are calculated on your phone and work offline. Your local mosque's timetable may differ by a few minutes, so follow it when you have it.")}</p>
        <motion.button className="btn big" onClick={onClose} {...tap}>{tr("Done")}</motion.button>
      </div>
    </BottomSheet>
  );
}
