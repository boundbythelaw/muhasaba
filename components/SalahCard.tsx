"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { PRAYERS, REASONS, reasonOf, type PrayerId } from "@/lib/constants";
import { excused } from "@/lib/scoring";
import { todayKey } from "@/lib/dates";
import { haptic, toast } from "@/lib/fx";
import { getLang, getName, tr } from "@/lib/i18n";
import { currentPrayer, fmtTime, METHOD_NAME, PRESETS, resolveMethod, timesFor, untilText, type MethodId, type PrayerLocation } from "@/lib/prayerTimes";
import { useStore } from "@/lib/store";
import type { PrayerMark } from "@/lib/types";
import { BottomSheet } from "./Sheets";
import { CardShell, Segmented, tap } from "./ui";

const OPTIONS = [
  { value: 0 as PrayerMark, label: "No mosque", sub: "0", tone: "bad" as const },
  { value: 1 as PrayerMark, label: "Mosque", sub: "late · 4" },
  { value: 2 as PrayerMark, label: "Before takbīr", sub: "8", tone: "top" as const },
];

export default function SalahCard() {
  const { day, scores, update, cur, prefs } = useStore();
  const [locOpen, setLocOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t); }, []);
  const atMosque = PRAYERS.filter(({ id }) => (day.prayers[id] ?? -1) >= 1).length;
  const early = PRAYERS.filter(({ id }) => day.prayers[id] === 2).length;
  const isToday = cur === todayKey();
  let times: ReturnType<typeof timesFor> | null = null;
  try { times = timesFor(cur, prefs.prayerLoc, prefs.asr); } catch { times = null; }
  const live = isToday && times ? currentPrayer(times, now) : null;
  const next = isToday && times ? PRAYERS.find(({ id }) => times![id].getTime() > now.getTime())?.id : undefined;
  const tz = prefs.prayerLoc.tz;
  const [ask, setAsk] = useState<PrayerId | null>(null);

  return (
    <CardShell id="sec-p" title="Salah" ar="الصلاة" value={scores.p} max={40} done={scores.p >= 40} summary={tr("All five in jamāʿah before the takbīr")}>
      <motion.button className="locbar" onClick={() => { setLocOpen(true); haptic(6); }} whileTap={{ scale: 0.98 }}>
        <span aria-hidden="true">📍</span>
        <b>{prefs.prayerLoc.label}</b>
        <span className="muted">{METHOD_NAME[resolveMethod(prefs.prayerLoc)]}{times ? ` · ${tr("Sunrise")} ${fmtTime(times.sunrise, tz)}` : ""}</span>
        <span className="change">{tr("Change")}</span>
      </motion.button>

      <div className="ch">
        <p className="sub" style={{ margin: 0 }}>{tr("{a} of 5 in the mosque · {b} before the takbīr", { a: atMosque, b: early })}</p>
        <div className="lamps" aria-hidden="true">
          {PRAYERS.map(({ id }) => {
            const v = day.prayers[id];
            return <motion.i key={id} className={v === 2 ? "t" : v === 1 ? "m" : ""} animate={{ scale: v === 2 ? [1, 1.5, 1] : 1 }} transition={{ duration: 0.4 }} />;
          })}
        </div>
      </div>

      <WhySheet id={ask} onClose={() => setAsk(null)} />

      {PRAYERS.map(({ id, en, ar }) => {
        const at = times?.[id];
        const isLive = live === id, isNext = next === id;
        const missed = isToday && at && at.getTime() < now.getTime() && day.prayers[id] == null && !isLive;
        return (
          <div className={`prow ${isLive ? "live" : ""} ${isNext ? "next" : ""}`} key={id}>
            <motion.button className="pname" title={tr("Tap to cycle")} {...tap}
              onClick={(e) => update((d) => { const c = d.prayers[id]; d.prayers[id] = c == null ? 2 : c === 2 ? 1 : c === 1 ? 0 : 2; if (d.prayers[id] === 2) delete d.why[id]; }, e)}>
              <b>{tr(en)}</b>
              <span className="ptime num">
                {at ? fmtTime(at, tz) : ""}
                {isLive && <em className="tag now">{tr("now")}</em>}
                {isNext && at && <em className="tag soon">{tr("in {t}", { t: untilText(at.getTime() - now.getTime(), getLang()) })}</em>}
                {missed && <em className="tag miss">{tr("log it")}</em>}
                {excused(day.why[id]) && <em className="tag ex">{tr("excused")}</em>}
              </span>
              <span className="par">{ar}</span>
            </motion.button>
            <Segmented ariaLabel={tr(en)} options={OPTIONS} value={day.prayers[id]}
              onSelect={(v, e) => {
                const was = day.prayers[id];
                void update((d) => { if (d.prayers[id] === v) { delete d.prayers[id]; delete d.why[id]; } else { d.prayers[id] = v; if (v === 2) delete d.why[id]; } }, e)
                  .then((ok) => { if (ok && was !== v && v !== 2 && !day.why[id]) setAsk(id); });
              }} />
            {(day.prayers[id] === 0 || day.prayers[id] === 1 || day.why[id]) && <WhyPill id={id} onOpen={() => setAsk(id)} />}
          </div>
        );
      })}

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

/* ---------- Why late / not at the mosque ---------- */

/** One small line under the prayer: the reason picked (tap to change), or a link to add one. */
function WhyPill({ id, onOpen }: { id: PrayerId; onOpen: () => void }) {
  const { day } = useStore();
  const w = day.why[id];
  const r = reasonOf(w?.r);
  return (
    <button className={`whypill ${r?.excuse ? (excused(w) ? "ex" : "exq") : r ? "set" : ""}`} onClick={() => { onOpen(); haptic(5); }}>
      {r ? <>{tr("Why")}: <b>{tr(r.label)}</b>{r.excuse ? (excused(w) ? ` · ${tr("excused")} ✓` : ` · ${tr("confirm")}…`) : ""}</> : <>+ {tr("Add a reason")}</>}
    </button>
  );
}

/** The popup that asks why, right after you mark a prayer "late" or "no mosque". */
function WhySheet({ id, onClose }: { id: PrayerId | null; onClose: () => void }) {
  const { day, update, prefs } = useStore();
  const p = PRAYERS.find((x) => x.id === id);
  const w = id ? day.why[id] : undefined;
  const r = reasonOf(w?.r);
  const list = REASONS.filter((x) => !x.women || prefs.gender === "f");
  const set = (rid: (typeof REASONS)[number]["id"]) => id && update((d) => {
    if (d.why[id]?.r === rid) delete d.why[id];
    else d.why[id] = { r: rid, ok: rid === "period" ? true : undefined };
  }, null, true, { noConfirm: true });
  return (
    <BottomSheet open={!!id} onClose={onClose} label={tr("Why?")}>
      {id && p && (
        <div className="sheet-body">
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
                {(w?.r === "travel" || w?.r === "period" || w?.r === "ill") && excused(w) && (
                  <motion.button {...tap} className="linkbtn" onClick={(e) => update((d) => {
                    for (const q of PRAYERS) { if (d.prayers[q.id] !== 2) { d.why[q.id] = { ...w! }; if (d.prayers[q.id] == null) d.prayers[q.id] = 0; } }
                  }, e, false, { noConfirm: true })}>{tr("Same for all of today's prayers")}</motion.button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
          <div className="lab">{tr("Other reasons")}</div>
          <div className="whychips">
            {list.filter((x) => !x.excuse).map((x) => (
              <motion.button key={x.id} {...tap} className={`whychip ${w?.r === x.id ? "on" : ""}`} onClick={() => { set(x.id); haptic(6); }}>{tr(x.label)}</motion.button>
            ))}
          </div>
          <motion.button className="btn big" {...tap} onClick={onClose}>{w ? tr("Done") : tr("Skip")}</motion.button>
        </div>
      )}
    </BottomSheet>
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
