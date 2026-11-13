"use client";
import { getLang, tr } from "@/lib/i18n";
import { useDictation } from "@/lib/dictation";
import VoiceNote from "./VoiceNote";
import { discardMedia, Lightbox, PhotoButtons, Thumb } from "./Photos";
import { MAX_PHOTOS } from "@/lib/photos";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { longDate, todayKey } from "@/lib/dates";
import { burst, haptic, toast } from "@/lib/fx";
import { useStore } from "@/lib/store";
import type { JournalEntry, PhotoRef, Verdict } from "@/lib/types";
import { tap } from "./ui";

const VERDICT: Record<Verdict, { label: string; cls: string; dot: string }> = {
  good: { label: "Good day", cls: "v-good", dot: "🟢" },
  hard_good: { label: "Hard but good", cls: "v-hardgood", dot: "🟡" },
  hard: { label: "Hard day", cls: "v-hard", dot: "🔴" },
};

const pad = (n: number) => String(n).padStart(2, "0");
const nowHM = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
const DRAFT_KEY = "muhasaba-journal-draft";

function prompts(): string[] {
  const h = new Date().getHours();
  const list = h < 11 ? ["After Subh I…", "My memorisation this morning…", "Today I intend to…"]
    : h < 16 ? ["This morning went…", "Something productive I did…", "Something that got in my way…"]
    : h < 20 ? ["This afternoon…", "A small win today…", "I struggled with…"]
    : ["Looking back on today…", "What I'm proud of…", "Tomorrow I want to…"];
  return list.map((p) => tr(p));
}

function AutoText({ value, onChange, placeholder, autoFocus, onSubmit, id }: {
  value: string; onChange: (v: string) => void; placeholder?: string; autoFocus?: boolean; onSubmit?: () => void; id?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 420) + "px";
  }, [value]);
  return (
    <textarea id={id} ref={ref} className="jtext" value={value} placeholder={placeholder} autoFocus={autoFocus} rows={3}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && onSubmit) { e.preventDefault(); onSubmit(); } }} />
  );
}

function EntryRow({ e, date, onSave, onDelete, onAddPhotos, onRemovePhoto, locked, onLocked }: {
  e: JournalEntry; date: string; onSave: (x: JournalEntry) => Promise<boolean>; onDelete: () => void;
  onAddPhotos: (p: PhotoRef[]) => void; onRemovePhoto: (p: PhotoRef) => Promise<boolean>; locked: boolean; onLocked: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(e.text);
  const [t, setT] = useState(e.t);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { if (!editing) { setText(e.text); setT(e.t); } }, [e, editing]);
  const photos = e.photos ?? [];
  return (
    <motion.li layout initial={{ opacity: 0, y: 14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: -40, height: 0, marginBottom: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 32 }} className={`jentry ${editing ? "editing" : ""}`}>
      <span className="jdot" aria-hidden="true" />
      {editing ? (
        <div className="jedit">
          <input className="inp jtime-in" type="time" value={t} onChange={(ev) => setT(ev.target.value)} aria-label={tr("Time")} />
          <AutoText value={text} onChange={setText} autoFocus onSubmit={async () => { if (await onSave({ ...e, t, text })) setEditing(false); }} />
          <div className="row">
            <motion.button className="btn" {...tap} onClick={async () => { if ((text.trim() || photos.length) && (await onSave({ ...e, t, text }))) { setEditing(false); haptic(10); } }}>{tr("Save")}</motion.button>
            <motion.button className="btn ghost" {...tap} onClick={() => setEditing(false)}>{tr("Cancel")}</motion.button>
            <motion.button className="btn danger" {...tap} onClick={onDelete} style={{ marginLeft: "auto" }}>{tr("Delete")}</motion.button>
          </div>
        </div>
      ) : (
        <button className="jbody" onClick={() => { if (locked) { onLocked(); return; } setEditing(true); haptic(6); }} aria-label={`Edit entry at ${e.t}`}>
          <span className="jtime num">{e.t}</span>
          {e.text ? <span className="jtxt">{e.text}</span> : <span className="jtxt note">{photos.every((p) => p.kind === "video") ? tr("Video") : tr("Photo")}</span>}
        </button>
      )}
      <div className="jphotos">
        <AnimatePresence initial={false}>
          {photos.map((p, i) => <Thumb key={p.id} p={p} date={date} onOpen={() => { setOpen(i); haptic(5); }} />)}
        </AnimatePresence>
        {photos.length < MAX_PHOTOS && (locked
          ? null
          : <PhotoButtons date={date} count={photos.length} onAdd={onAddPhotos} compact />)}
      </div>
      <AnimatePresence>
        {open !== null && photos.length > 0 && (
          <Lightbox photos={photos} index={open} date={date} caption={e.t} onClose={() => setOpen(null)}
            onRemove={locked ? undefined : async (p) => { if (await onRemovePhoto(p)) { if (photos.length <= 1) setOpen(null); else setOpen((x) => Math.max(0, Math.min(x ?? 0, photos.length - 2))); } }} />
        )}
      </AnimatePresence>
    </motion.li>
  );
}

export default function JournalView() {
  const { day, cur, update, sheet, docs, polishDay, lookupDocs, setView, locked, requestUnlock } = useStore();
  const isToday = cur === todayKey();
  const [draft, setDraft] = useState("");
  const [time, setTime] = useState(nowHM());
  const [timeTouched, setTimeTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [undo, setUndo] = useState<JournalEntry | null>(null);
  const [draftPhotos, setDraftPhotos] = useState<PhotoRef[]>([]);
  const [openDraft, setOpenDraft] = useState<number | null>(null);
  const info = docs[cur];
  const entries = useMemo(() => [...day.journal].sort((a, b) => a.t.localeCompare(b.t)), [day.journal]);
  const totalWords = entries.reduce((n, e) => n + words(e.text), 0);

  // Restore an unsent draft for this day.
  useEffect(() => {
    try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}"); setDraft(d[cur] || ""); } catch { setDraft(""); }
    setTimeTouched(false);
    setTime(nowHM());
    setDraftPhotos([]);
  }, [cur]);
  useEffect(() => {
    try { const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}"); if (draft) d[cur] = draft; else delete d[cur]; localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* ignore */ }
  }, [draft, cur]);
  // Keep the time chip on "now" until the user changes it.
  useEffect(() => {
    if (timeTouched) return;
    const t = setInterval(() => setTime(nowHM()), 20000);
    return () => clearInterval(t);
  }, [timeTouched]);
  // Fetch the latest rating and doc link for this day.
  useEffect(() => { if (sheet.url) lookupDocs([cur]); }, [cur, sheet.url, lookupDocs]);
  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo(null), 6000); return () => clearTimeout(t); }, [undo]);

  const add = (e?: React.MouseEvent) => addText(draft, e);
  const addText = (raw: string, e?: React.MouseEvent, at?: string) => {
    const text = raw.trim();
    // A voice note arrives on its own, so only the typed entry takes the photos waiting in the composer.
    const photos = at ? [] : draftPhotos;
    if (!text && !photos.length) return;
    const entry: JournalEntry = { id: newId(), t: at ?? (timeTouched ? time : nowHM()), text, ...(photos.length ? { photos } : {}) };
    update((d) => { d.journal.push(entry); }, null, true);
    if (!at) setDraftPhotos([]);
    setDraft("");
    setTimeTouched(false);
    setTime(nowHM());
    haptic(14);
    if (e) burst(e.clientX, e.clientY);
    if (entries.length === 0) toast(tr("First entry of the day. Keep going."));
  };

  const polish = async (e: React.MouseEvent) => {
    const pt = { x: e.clientX, y: e.clientY };
    setBusy(true);
    const r = await polishDay(cur);
    setBusy(false);
    if (r.ok) { burst(pt.x, pt.y, true); haptic([15, 30, 15]); toast(tr("Polished and saved to Google Docs.")); }
    else toast(r.error || tr("Couldn't polish right now."));
  };

  const v = info?.verdict ? VERDICT[info.verdict] : null;

  return (
    <>
      {/* Verdict + doc link */}
      <motion.section layout className={`card jhead ${v ? v.cls : ""}`}>
        <div className="ch">
          <h2>{tr("Journal")}<span className="ar">اليوميات</span></h2>
          <AnimatePresence mode="wait">
            {v ? (
              <motion.span key={info!.verdict} className="vchip" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }}>
                {v.dot} {tr(v.label)}
              </motion.span>
            ) : (
              <motion.span key="none" className="badge" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{tr(entries.length === 1 ? "{n} entry" : "{n} entries", { n: entries.length })}</motion.span>
            )}
          </AnimatePresence>
        </div>
        {v && (info?.title || info?.summary) ? (
          <div className="vsum">
            {info?.title && <b>{info.title}</b>}
            {info?.summary && <p>{info.summary}</p>}
          </div>
        ) : (
          <p className="sub">
            {tr("Write what happens through the day. Each entry is timestamped. Your sheet turns the day into a polished Google Doc, fixes the spelling, and rates it as a good, hard-but-good or hard day.")}
          </p>
        )}
        <div className="row">
          {info?.url && (
            <motion.a className="btn doclink" href={info.url} target="_blank" rel="noreferrer" {...tap}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" /></svg>
              {tr("Open in Google Docs")}
            </motion.a>
          )}
          {sheet.url ? (
            <motion.button className={`btn ${info?.url ? "ghost" : ""}`} onClick={polish} disabled={busy || (!entries.length && !day.shukr.trim())} {...tap}>
              {busy ? <span className="spinner" aria-hidden="true" /> : null}
              {tr(busy ? "Polishing…" : info?.url ? (info.pending ? "Update the Doc" : "Polish again") : "Polish & save to Docs")}
            </motion.button>
          ) : (
            <button className="linkbtn" onClick={() => setView("record")}>{tr("Connect your Google Sheet to get Docs →")}</button>
          )}
        </div>
        {sheet.url && info?.error && !busy && <p className="note warnnote">⚠ {info.error}</p>}
        {sheet.url && info?.pending && !busy && <p className="note">{tr("You've written more since the last polish. It updates by itself 30 minutes after you stop writing, or tap Update.")}</p>}
      </motion.section>

      {/* Composer */}
      {!locked && <section className="card composer">
        <div className="ch">
          <div className="lab">{isToday ? tr("What just happened?") : tr("Add to {d}", { d: longDate(cur) })}</div>
          <label className="timechip">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            <input type="time" value={time} aria-label={tr("Entry time")} onChange={(e) => { setTime(e.target.value); setTimeTouched(true); }} />
          </label>
        </div>
        <AutoText id="jdraft" value={draft} onChange={setDraft} onSubmit={() => add()} placeholder={tr("Write freely. Typos are fine, they get fixed in your Doc.")} />
        <AnimatePresence initial={false}>
          {!draft && (
            <motion.div className="row" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
              {prompts().map((p) => (
                <motion.button key={p} className="pill prompt" {...tap} onClick={() => { setDraft(p.replace(/…$/, " ")); haptic(5); document.getElementById("jdraft")?.focus(); }}>{p}</motion.button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="jphotos composerphotos">
          <AnimatePresence initial={false}>
            {draftPhotos.map((p, i) => (
              <Thumb key={p.id} p={p} date={cur} onOpen={() => setOpenDraft(i)}
                onRemove={() => { setDraftPhotos((x) => x.filter((y) => y.id !== p.id)); discardMedia(p, null); haptic(6); }} />
            ))}
          </AnimatePresence>
          <PhotoButtons date={cur} count={draftPhotos.length} onAdd={(p) => setDraftPhotos((x) => [...x, ...p])} />
        </div>
        <AnimatePresence>
          {openDraft !== null && draftPhotos.length > 0 && (
            <Lightbox photos={draftPhotos} index={openDraft} date={cur} caption={tr("Not added yet")} onClose={() => setOpenDraft(null)}
              onRemove={(p) => { setDraftPhotos((x) => x.filter((y) => y.id !== p.id)); discardMedia(p, null); setOpenDraft(null); }} />
          )}
        </AnimatePresence>
        <VoiceNote onText={(text, t) => addText(text, undefined, t)} />
        <details className="livedict">
          <summary>{tr("Live dictation (free, less accurate)")}</summary>
          <MicBar draft={draft} setDraft={setDraft} onSave={(text, e) => addText(text, e)} />
        </details>
        <div className="ch">
          <span className="note num">{tr("{n} words", { n: words(draft) })}</span>
          <motion.button className="btn" onClick={add} disabled={!draft.trim() && !draftPhotos.length} {...tap}>{tr("Add entry")}</motion.button>
        </div>
      </section>}

      {/* Timeline */}
      <section className="card">
        <div className="ch">
          <h2 style={{ fontSize: 18 }}>{tr(isToday ? "Today so far" : "That day")}</h2>
          <span className="note num">{tr("{n} words", { n: totalWords })}{entries.length ? ` · ${entries[0].t}–${entries[entries.length - 1].t}` : ""}</span>
        </div>
        {entries.length === 0 ? (
          <p className="empty">{tr("Nothing written yet. Your first entry appears here with its time.")}</p>
        ) : (
          <ul className="timeline">
            <AnimatePresence initial={false}>
              {entries.map((e) => (
                <EntryRow key={e.id} e={e} date={cur} locked={locked} onLocked={() => requestUnlock(cur)}
                  onAddPhotos={(ps) => { update((d) => { const x = d.journal.find((y) => y.id === e.id); if (x) x.photos = [...(x.photos ?? []), ...ps].slice(0, MAX_PHOTOS); }, null, true, { noConfirm: true }); }}
                  onRemovePhoto={async (p) => {
                    const ok = await update((d) => { const x = d.journal.find((y) => y.id === e.id); if (x) x.photos = (x.photos ?? []).filter((y) => y.id !== p.id); }, null, true);
                    if (ok) { discardMedia(p, sheet.url); haptic(8); }
                    return ok;
                  }}
                  onSave={(x) => update((d) => { const i = d.journal.findIndex((y) => y.id === x.id); if (i >= 0) d.journal[i] = { ...d.journal[i], t: x.t, text: x.text.trim() }; }, null, true)}
                  onDelete={async () => { if (await update((d) => { d.journal = d.journal.filter((y) => y.id !== e.id); }, null, true)) { setUndo(e); haptic(8); } }} />
              ))}
            </AnimatePresence>
          </ul>
        )}
        <AnimatePresence>
          {undo && (
            <motion.div className="undo" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
              <span>{tr("Entry deleted")}</span>
              <button className="linkbtn" onClick={() => { const u = undo; update((d) => { d.journal.push(u); }, null, true, { noConfirm: true }); setUndo(null); }}>{tr("Undo")}</button>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      <p className="foot">{tr("Your journal stays on your phone and in your own Google Drive. The sheet only shows the rating and a link.")}</p>
    </>
  );
}

/* ---------- Speak instead of typing ---------- */
const MIC_LANG_KEY = "muhasaba-mic-lang";
function MicBar({ draft, setDraft, onSave }: { draft: string; setDraft: (v: string | ((x: string) => string)) => void; onSave: (text: string, e: React.MouseEvent) => void }) {
  const [lang, setLang] = useState<"fr-FR" | "en-GB">(() => {
    try { const v = localStorage.getItem(MIC_LANG_KEY); if (v === "fr-FR" || v === "en-GB") return v; } catch { /* ignore */ }
    return getLang() === "fr" ? "fr-FR" : "en-GB";
  });
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [secs, setSecs] = useState(0);
  const { listening, interim, error, start, stop, supported } = useDictation(lang, (text) => {
    setDraft((d) => (d.trim() ? d.replace(/\s*$/, " ") : "") + text);
    haptic(4);
  });
  useEffect(() => {
    if (!listening) { setSecs(0); return; }
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [listening]);
  const swap = () => {
    const next = lang === "fr-FR" ? "en-GB" : "fr-FR";
    setLang(next);
    try { localStorage.setItem(MIC_LANG_KEY, next); } catch { /* ignore */ }
    haptic(5);
    if (listening) { stop(); setTimeout(start, 250); }
  };
  if (!supported) return <p className="note">{tr("Voice typing isn't available in this browser. Use the 🎤 on your keyboard instead.")}</p>;

  return (
    <div className={`micbar ${listening ? "on" : ""}`}>
      {!listening ? (
        <div className="micrest">
          <motion.button className="micbtn" onClick={() => { start(); haptic(12); }} whileTap={{ scale: 0.9 }} aria-label={tr("Speak instead of typing")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          </motion.button>
          <span className="miclabel">{tr("Tap to speak")}</span>
          <button className="langchip" onClick={swap} aria-label={tr("Speech language")}>{lang === "fr-FR" ? "FR" : "EN"}</button>
        </div>
      ) : (
        <motion.div className="miclive" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <div className="micwave" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((i) => (
              <motion.i key={i} animate={{ scaleY: [0.3, 1, 0.45, 0.9, 0.3] }} transition={{ repeat: Infinity, duration: 1.1, delay: i * 0.12 }} />
            ))}
          </div>
          <div className="mictext">
            <b className="num">{tr("Listening…")} {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</b>
            <span>{interim || tr("Speak naturally. Pause whenever you like.")}</span>
          </div>
          <button className="langchip" onClick={swap} aria-label={tr("Speech language")}>{lang === "fr-FR" ? "FR" : "EN"}</button>
          <div className="micactions">
            <motion.button className="btn ghost" onClick={() => { stop(); if (interim) setDraft((d) => (d.trim() ? d + " " : "") + interim); haptic(8); }} {...tap}>{tr("Stop")}</motion.button>
            <motion.button className="btn" {...tap} onClick={(e) => {
              stop();
              const text = (draftRef.current.trim() + " " + interim).trim();
              if (text) onSave(text, e); else toast(tr("Nothing heard yet."));
            }}>{tr("Save entry")}</motion.button>
          </div>
        </motion.div>
      )}
      {error && (
        <p className="err">{tr(error === "not-allowed" ? "Microphone access was refused. Allow it for this site in Chrome's settings." : error === "network" ? "Voice typing needs an internet connection." : "Voice typing stopped. Tap the mic to try again.")}</p>
      )}
    </div>
  );
}
