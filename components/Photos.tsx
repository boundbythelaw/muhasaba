"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { haptic, toast } from "@/lib/fx";
import { tr } from "@/lib/i18n";
import {
  compress, deletePhoto, fmtDur, ingestVideo, MAX_PHOTOS, MAX_REC_SECONDS, newPhotoId, posterId, putPhoto, recMime, usePhotoUrl,
} from "@/lib/photos";
import { postToSheet } from "@/lib/sheetSync";
import { useStore } from "@/lib/store";
import type { PhotoRef } from "@/lib/types";
import { tap } from "./ui";

const CamIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
);
const VidIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="6" width="13" height="12" rx="2.5" /><path d="m15.5 10.5 6-3.5v10l-6-3.5" /></svg>
);
const GalIcon = () => (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle cx="9" cy="10" r="1.8" /><path d="m21 16-5-5-9 9" /></svg>
);

const isVideoFile = (f: File) => f.type.startsWith("video/") || /\.(mp4|mov|webm|3gp|mkv)$/i.test(f.name);
const isImageFile = (f: File) => f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name);
const mb = (n: number) => Math.round(n / 1024 / 1024);

/** Turn picked files into stored photos (compressed) and videos (with a cover picture). */
async function ingest(files: FileList | null, date: string, room: number): Promise<PhotoRef[]> {
  const list = Array.from(files ?? []).filter((f) => isImageFile(f) || isVideoFile(f));
  if (list.length > room) toast(tr("Up to {n} photos or videos per entry.", { n: MAX_PHOTOS }));
  const out: PhotoRef[] = [];
  for (const f of list.slice(0, room)) {
    try {
      if (isVideoFile(f)) {
        out.push(await ingestVideo(f, date));
        if (f.size > 40 * 1024 * 1024) toast(tr("Big video ({n} MB). It uploads in the background, piece by piece.", { n: mb(f.size) }));
        continue;
      }
      const { blob, w, h } = await compress(f);
      const id = newPhotoId();
      await putPhoto({ id, date, blob, w, h, added: Date.now() });
      out.push({ id });
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      toast(m === "bigvideo" ? tr("This video is over 300 MB. Trim it in your gallery first, or record it in Muhasaba.") : m || tr("Couldn't add that photo."));
    }
  }
  return out;
}

/** Remove a photo or video everywhere: on this phone and in Drive. */
export function discardMedia(p: PhotoRef, sheetUrl: string | null) {
  void deletePhoto(p.id);
  if (p.kind === "video") void deletePhoto(posterId(p.id));
  if (sheetUrl) for (const d of [p.drive, p.poster]) if (d) void postToSheet(sheetUrl, { photoDelete: d });
}

/** Camera (photo), Video (in-app recorder) and Gallery (photos and videos) buttons. */
export function PhotoButtons({ date, count, onAdd, compact, disabled }: { date: string; count: number; onAdd: (p: PhotoRef[]) => void; compact?: boolean; disabled?: boolean }) {
  const cam = useRef<HTMLInputElement>(null);
  const gal = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState(false);
  const room = MAX_PHOTOS - count;
  const pick = async (files: FileList | null, el: HTMLInputElement | null) => {
    if (!files?.length) return;
    setBusy(true);
    const refs = await ingest(files, date, room);
    setBusy(false);
    if (el) el.value = "";
    if (refs.length) { onAdd(refs); haptic(10); }
  };
  const off = disabled || busy || room <= 0;
  return (
    <div className={`photobtns ${compact ? "compact" : ""}`}>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files, e.target)} />
      <input ref={gal} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => pick(e.target.files, e.target)} />
      <motion.button type="button" className="pill photobtn" disabled={off} onClick={() => cam.current?.click()} {...tap} aria-label={tr("Take a photo")}>
        {busy ? <span className="spinner" aria-hidden="true" /> : <CamIcon />}{!compact && <span>{tr("Photo")}</span>}
      </motion.button>
      <motion.button type="button" className="pill photobtn" disabled={off} onClick={() => setRec(true)} {...tap} aria-label={tr("Record a video")}>
        <VidIcon />{!compact && <span>{tr("Video")}</span>}
      </motion.button>
      <motion.button type="button" className="pill photobtn" disabled={off} onClick={() => gal.current?.click()} {...tap} aria-label={tr("Add from gallery")}>
        <GalIcon />{!compact && <span>{tr("Gallery")}</span>}
      </motion.button>
      {room <= 0 && !compact && <span className="note">{tr("Up to {n} photos or videos per entry.", { n: MAX_PHOTOS })}</span>}
      <AnimatePresence>
        {rec && <VideoRecorder date={date} onClose={() => setRec(false)} onDone={(r) => { setRec(false); onAdd([r]); haptic(12); }} />}
      </AnimatePresence>
    </div>
  );
}

/* ------------------------------------------------------------------ recorder */

type RecState = "starting" | "live" | "rec" | "review" | "saving" | "error";

/** Recording quality. "hd" keeps detail; "saver" keeps files small on mobile data. Remembered on this phone. */
const QUALITY = {
  hd: { w: 1920, h: 1080, bps: 10_000_000, label: "Full HD", mbMin: 75 },
  saver: { w: 1280, h: 720, bps: 2_500_000, label: "Data saver", mbMin: 19 },
} as const;
type Quality = keyof typeof QUALITY;
const QKEY = "muhasaba-video-quality";
const loadQ = (): Quality => { try { return localStorage.getItem(QKEY) === "saver" ? "saver" : "hd"; } catch { return "hd"; } };

/**
 * Records straight in the app, in Full HD by default (about 75 MB a minute) or in Data saver (about 19 MB).
 * "Camera app" opens the phone's own camera instead, for its full original quality.
 */
function VideoRecorder({ date, onClose, onDone }: { date: string; onClose: () => void; onDone: (r: PhotoRef) => void }) {
  const [state, setState] = useState<RecState>("starting");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [quality, setQuality] = useState<Quality>(loadQ);
  const native = useRef<HTMLInputElement>(null);
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ blob: Blob; url: string; secs: number } | null>(null);
  const live = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const started = useRef(0);
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopStream = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; };

  const open = useCallback(async (face: "environment" | "user", q: Quality) => {
    stopStream();
    setState("starting");
    if (!navigator.mediaDevices?.getUserMedia || !recMime()) { setErr(tr("This browser can't record video. Use the Gallery button with a video from your camera app.")); setState("error"); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: face }, width: { ideal: QUALITY[q].w }, height: { ideal: QUALITY[q].h }, frameRate: { ideal: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      stream.current = s;
      if (live.current) { live.current.srcObject = s; void live.current.play().catch(() => undefined); }
      setState("live");
    } catch (e) {
      const name = (e as DOMException)?.name;
      setErr(name === "NotAllowedError" ? tr("Muhasaba needs the camera and microphone. Allow them for this site in Chrome (🔒 next to the address) and try again.") : tr("Couldn't open the camera."));
      setState("error");
    }
  }, []);

  useEffect(() => {
    void open(facing, quality);
    return () => { stopStream(); if (tick.current) clearInterval(tick.current); };
  }, [facing, quality, open]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  const stop = useCallback(() => {
    if (tick.current) { clearInterval(tick.current); tick.current = null; }
    try { recorder.current?.stop(); } catch { /* ignore */ }
  }, []);

  const start = () => {
    const s = stream.current;
    if (!s) return;
    const mimeType = recMime();
    const chunks: Blob[] = [];
    const r = new MediaRecorder(s, { mimeType, videoBitsPerSecond: QUALITY[quality].bps, audioBitsPerSecond: 128_000 });
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = () => {
      const took = (Date.now() - started.current) / 1000;
      const blob = new Blob(chunks, { type: mimeType.split(";")[0] });
      stopStream();
      setResult({ blob, url: URL.createObjectURL(blob), secs: took });
      setState("review");
    };
    recorder.current = r;
    r.start(1000);
    started.current = Date.now();
    setSecs(0);
    setState("rec");
    haptic(15);
    tick.current = setInterval(() => {
      const s2 = (Date.now() - started.current) / 1000;
      setSecs(s2);
      if (s2 >= MAX_REC_SECONDS) stop();
    }, 250);
  };

  const retake = () => { setResult(null); setSecs(0); void open(facing, quality); };
  const pickQuality = (q: Quality) => { setQuality(q); try { localStorage.setItem(QKEY, q); } catch { /* ignore */ } haptic(6); };
  // The phone's own camera app: best quality, untouched (bigger files).
  const fromCameraApp = async (f: File | undefined) => {
    if (!f) return;
    stopStream();
    setState("saving");
    try {
      onDone(await ingestVideo(f, date));
      if (f.size > 40 * 1024 * 1024) toast(tr("Big video ({n} MB). It uploads in the background, piece by piece.", { n: mb(f.size) }));
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setErr(m === "bigvideo" ? tr("This video is over 300 MB. Trim it in your gallery first, or record it in Muhasaba.") : m || tr("Couldn't save the video."));
      setState("error");
    }
  };
  const use = async () => {
    if (!result) return;
    setState("saving");
    try {
      onDone(await ingestVideo(result.blob, date, result.secs));
    } catch (e) {
      setErr(e instanceof Error ? e.message : tr("Couldn't save the video."));
      setState("error");
    }
  };
  const close = () => { stop(); stopStream(); onClose(); };

  if (typeof document === "undefined") return null;
  return createPortal(
    <motion.div className="recorder" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-label={tr("Record a video")}>
      <div className="recview">
        {state === "review" || state === "saving"
          ? result && <video key="review" src={result.url} controls playsInline autoPlay />
          : <video key="live" ref={live} muted playsInline autoPlay className={facing === "user" ? "mirror" : ""} />}
        {state === "starting" && <span className="spinner recspin" />}
        {state === "error" && <p className="recerr">{err}</p>}
        {state === "rec" && (
          <div className="rectime num"><i />{fmtDur(secs)} <span>/ {fmtDur(MAX_REC_SECONDS)}</span></div>
        )}
        {state === "rec" && <div className="recbar" style={{ width: `${(secs / MAX_REC_SECONDS) * 100}%` }} />}
        {(state === "live" || state === "starting" || state === "error") && (
          <div className="rectop">
            <div className="recq" role="radiogroup" aria-label={tr("Quality")}>
              {(Object.keys(QUALITY) as Quality[]).map((q) => (
                <button key={q} role="radio" aria-checked={quality === q} className={quality === q ? "on" : ""} onClick={() => pickQuality(q)}>
                  {tr(QUALITY[q].label)}<small>~{QUALITY[q].mbMin} {tr("MB/min")}</small>
                </button>
              ))}
            </div>
            <input ref={native} type="file" accept="video/*" capture="environment" hidden onChange={(e) => fromCameraApp(e.target.files?.[0])} />
            <button className="recnative" onClick={() => native.current?.click()}>{tr("Camera app")}<small>{tr("best quality")}</small></button>
          </div>
        )}
      </div>
      <div className="recctl">
        {state === "review" || state === "saving" ? (
          <>
            <motion.button className="btn ghost light" {...tap} onClick={retake} disabled={state === "saving"}>{tr("Retake")}</motion.button>
            <span className="recinfo num">{result ? `${fmtDur(result.secs)} · ${Math.max(1, mb(result.blob.size))} MB` : ""}</span>
            <motion.button className="btn" {...tap} onClick={use} disabled={state === "saving"}>
              {state === "saving" ? <span className="spinner" /> : null}{tr("Use this video")}
            </motion.button>
          </>
        ) : (
          <>
            <motion.button className="btn ghost light" {...tap} onClick={close}>{tr("Cancel")}</motion.button>
            <motion.button className={`recbtn ${state === "rec" ? "on" : ""}`} {...tap} disabled={state !== "live" && state !== "rec"}
              onClick={() => (state === "rec" ? stop() : start())} aria-label={state === "rec" ? tr("Stop") : tr("Start recording")}>
              <span />
            </motion.button>
            <motion.button className="btn ghost light" {...tap} disabled={state === "rec" || state === "starting"}
              onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))} aria-label={tr("Switch camera")}>⟲</motion.button>
          </>
        )}
      </div>
    </motion.div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ tiles & viewer */

/** One photo/video tile with its upload state. */
export function Thumb({ p, date, onOpen, onRemove, size = 76 }: { p: PhotoRef; date: string; onOpen?: () => void; onRemove?: () => void; size?: number }) {
  const isVid = p.kind === "video";
  const imgId = isVid ? posterId(p.id) : p.id;
  const imgDrive = isVid ? p.poster : p.drive;
  const url = usePhotoUrl(imgId);
  const { photoUp, fetchPhoto, sheet } = useStore();
  const tried = useRef(false);
  const [fetching, setFetching] = useState(false);
  // Not on this phone (new phone or restored backup): bring the picture back from Drive.
  useEffect(() => {
    if (url !== null || !imgDrive || tried.current || !sheet.url) return;
    tried.current = true;
    setFetching(true);
    void fetchPhoto(imgId, imgDrive, date).finally(() => setFetching(false));
  }, [url, imgDrive, imgId, date, fetchPhoto, sheet.url]);
  const saved = isVid ? !!(p.drive && p.poster) : !!p.drive;
  const state = saved ? "saved" : photoUp.busy === p.id ? "up" : photoUp.failed[p.id] ? "err" : "wait";
  const pct = photoUp.progress[p.id];
  const label = { saved: tr("Saved in your Drive"), up: tr("Uploading to your Drive…"), err: photoUp.failed[p.id] || "", wait: sheet.url ? tr("Waiting to upload") : tr("On this phone only. Connect your Google Sheet to save it in Drive.") }[state];
  return (
    <motion.div className={`thumb ${isVid ? "vid" : ""}`} style={{ width: size, height: size }} layout initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }}>
      <button type="button" className="thumbimg" onClick={onOpen} aria-label={isVid ? tr("Play video") : tr("Open photo")}>
        {url ? <img src={url} alt="" draggable={false} /> : <span className="thumbph">{fetching ? <span className="spinner" /> : isVid ? "🎬" : "📷"}</span>}
        {isVid && p.dur ? <span className="thumbdur num">{fmtDur(p.dur)}</span> : null}
      </button>
      {state === "up" && isVid && pct != null && (
        <span className="thumbprog"><span style={{ width: `${Math.max(4, pct * 100)}%` }} /></span>
      )}
      <span className={`thumbstate s-${state}`} title={label} aria-label={label}>
        {state === "saved" ? "✓" : state === "up" ? <span className="spinner" /> : state === "err" ? "!" : "↑"}
      </span>
      {onRemove && (
        <button type="button" className="thumbx" onClick={onRemove} aria-label={tr("Remove photo")}>×</button>
      )}
    </motion.div>
  );
}

function Slide({ p }: { p: PhotoRef }) {
  const isVid = p.kind === "video";
  const vid = usePhotoUrl(isVid ? p.id : "");
  const img = usePhotoUrl(isVid ? posterId(p.id) : p.id);
  if (isVid && vid) return <motion.video key={p.id} src={vid} poster={img || undefined} controls playsInline autoPlay initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />;
  if (img) return (
    <motion.div key={p.id} className="lbslide" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
      <img src={img} alt="" draggable={false} />
      {isVid && p.drive && (
        <a className="btn lbdrive" href={`https://drive.google.com/file/d/${p.drive}/view`} target="_blank" rel="noreferrer">▶ {tr("Watch in Drive")}</a>
      )}
    </motion.div>
  );
  return <span className="spinner" />;
}

/** Full-screen viewer for photos and videos. */
export function Lightbox({ photos, index, caption, onClose, onRemove }: {
  photos: PhotoRef[]; index: number; date?: string; caption?: string; onClose: () => void; onRemove?: (p: PhotoRef) => void;
}) {
  const [i, setI] = useState(index);
  const p = photos[Math.min(i, photos.length - 1)];
  const { photoUp } = useStore();
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); if (e.key === "ArrowRight") setI((x) => Math.min(x + 1, photos.length - 1)); if (e.key === "ArrowLeft") setI((x) => Math.max(x - 1, 0)); };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [onClose, photos.length]);
  useEffect(() => { if (!photos.length) onClose(); }, [photos.length, onClose]);
  if (!p || typeof document === "undefined") return null;
  const isVid = p.kind === "video";
  const saved = isVid ? !!(p.drive && p.poster) : !!p.drive;
  const pct = photoUp.progress[p.id];
  const status = saved ? tr("Saved in your Drive")
    : photoUp.busy === p.id ? (pct != null ? tr("Uploading… {n}%", { n: Math.round(pct * 100) }) : tr("Uploading to your Drive…"))
    : photoUp.failed[p.id] || tr("Waiting to upload");
  return createPortal(
    <motion.div className="lightbox" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} role="dialog" aria-label={isVid ? tr("Video") : tr("Photo")}>
      <motion.div className="lbframe" drag={isVid ? false : "x"} dragConstraints={{ left: 0, right: 0 }} dragElastic={0.4}
        onDragEnd={(_, info) => { if (info.offset.x < -60) setI((x) => Math.min(x + 1, photos.length - 1)); else if (info.offset.x > 60) setI((x) => Math.max(x - 1, 0)); }}
        onClick={(e) => e.stopPropagation()}>
        <AnimatePresence mode="wait"><Slide key={p.id} p={p} /></AnimatePresence>
      </motion.div>
      <div className="lbbar" onClick={(e) => e.stopPropagation()}>
        {photos.length > 1 && (
          <motion.button className="btn ghost light lbnav" {...tap} disabled={i === 0} onClick={() => setI((x) => Math.max(0, x - 1))} aria-label={tr("Previous")}>‹</motion.button>
        )}
        <div className="lbinfo">
          {caption && <b className="num">{caption}{isVid && p.dur ? ` · ${fmtDur(p.dur)}` : ""}</b>}
          <span>{status}{photos.length > 1 ? ` · ${i + 1}/${photos.length}` : ""}</span>
        </div>
        {photos.length > 1 && (
          <motion.button className="btn ghost light lbnav" {...tap} disabled={i >= photos.length - 1} onClick={() => setI((x) => Math.min(photos.length - 1, x + 1))} aria-label={tr("Next")}>›</motion.button>
        )}
        {onRemove && <motion.button className="btn danger" {...tap} onClick={() => onRemove(p)}>{tr("Remove")}</motion.button>}
        <motion.button className="btn" {...tap} onClick={onClose}>{tr("Close")}</motion.button>
      </div>
    </motion.div>,
    document.body,
  );
}
