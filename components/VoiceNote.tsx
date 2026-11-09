"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { haptic, toast } from "@/lib/fx";
import { tr } from "@/lib/i18n";
import { postToSheet } from "@/lib/sheetSync";
import { useStore } from "@/lib/store";
import { tap } from "./ui";

const MAX_SECONDS = 600;
const PENDING_KEY = "muhasaba-pending-voice";
const pad = (n: number) => String(n).padStart(2, "0");
const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function pickMime() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) if (MediaRecorder.isTypeSupported?.(m)) return m;
  return "";
}

const toBase64 = (blob: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] ?? "");
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

type Pending = { audio: string; mime: string; t: string; date: string };
type Phase = "idle" | "recording" | "sending" | "failed";

/**
 * Record a voice note, send it to your Google script, which has OpenAI's speech-to-text write it out.
 * The text arrives as a timestamped journal entry. A failed upload is kept on the phone to retry.
 */
export default function VoiceNote({ onText }: { onText: (text: string, t: string, date: string) => void }) {
  const { sheet, cur, setView } = useStore();
  const [phase, setPhase] = useState<Phase>("idle");
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAt = useRef(new Date());
  const cancelled = useRef(false);
  const barsRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    try { const p = JSON.parse(localStorage.getItem(PENDING_KEY) || "null"); if (p?.audio) { setPending(p); setPhase("failed"); setErr(tr("A voice note wasn't transcribed yet.")); } } catch { /* ignore */ }
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (phase !== "recording") return;
    const t = setInterval(() => setSecs((s) => { if (s + 1 >= MAX_SECONDS) stop(); return s + 1; }), 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const cleanup = () => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try { ctxRef.current?.close(); } catch { /* ignore */ }
    ctxRef.current = null;
  };

  const meter = (stream: MediaStream) => {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      ctxRef.current = ctx;
      const an = ctx.createAnalyser();
      an.fftSize = 64;
      ctx.createMediaStreamSource(stream).connect(an);
      const data = new Uint8Array(an.frequencyBinCount);
      const loop = () => {
        an.getByteFrequencyData(data);
        const bars = barsRef.current?.children;
        if (bars) for (let i = 0; i < bars.length; i++) {
          const v = data[2 + i * 2] / 255;
          (bars[i] as HTMLElement).style.transform = `scaleY(${0.15 + v * 0.95})`;
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      loop();
    } catch { /* meter is decoration only */ }
  };

  const send = async (p: Pending) => {
    setPhase("sending");
    setErr("");
    const r = await postToSheet(sheet.url, { transcribe: { audio: p.audio, mime: p.mime } }, true) as { ok: boolean; text?: string; error?: string };
    if (r.ok && r.text) {
      try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
      setPending(null);
      setPhase("idle");
      onText(r.text, p.t, p.date);
      haptic([12, 30, 12]);
      toast(tr("Voice note added to your journal."));
      return;
    }
    if (r.ok && !r.text) { setPhase("idle"); setPending(null); try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ } toast(tr("Nothing was heard in that recording.")); return; }
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch { /* too big to keep */ }
    setPending(p);
    setPhase("failed");
    setErr(r.error === "offline" ? tr("You're offline. The recording is kept; tap Retry when you're back online.")
      : r.error === "unreachable" ? tr("Your sheet didn't answer. Update the script (new version) and tap Retry.")
      : r.error || tr("Couldn't transcribe."));
  };

  const start = async () => {
    setErr("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setErr(tr("Recording isn't supported in this browser.")); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const mime = pickMime();
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
      chunks.current = [];
      cancelled.current = false;
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      rec.onstop = async () => {
        cleanup();
        if (cancelled.current) { setPhase("idle"); return; }
        const blob = new Blob(chunks.current, { type: rec.mimeType || mime || "audio/webm" });
        if (blob.size < 2000) { setPhase("idle"); toast(tr("That was too short to transcribe.")); return; }
        const audio = await toBase64(blob);
        await send({ audio, mime: blob.type, t: hm(startedAt.current), date: cur });
      };
      recRef.current = rec;
      startedAt.current = new Date();
      setSecs(0);
      rec.start(1000);
      setPhase("recording");
      haptic(15);
      meter(stream);
    } catch {
      cleanup();
      setErr(tr("Microphone access was refused. Allow it for this site in Chrome's settings."));
    }
  };
  const stop = () => { try { recRef.current?.stop(); } catch { /* ignore */ } haptic(10); };
  const cancel = () => { cancelled.current = true; stop(); toast(tr("Recording discarded.")); };

  if (!sheet.url) {
    return (
      <button className="voice off" onClick={() => setView("record")}>
        <span className="vbtn" aria-hidden="true">🎙️</span>
        <span className="vtxt"><b>{tr("Voice notes")}</b><small>{tr("Connect your Google Sheet to transcribe voice notes →")}</small></span>
      </button>
    );
  }

  return (
    <div className={`voice ${phase}`}>
      <AnimatePresence mode="wait" initial={false}>
        {phase === "idle" && (
          <motion.button key="idle" className="voicestart" onClick={start} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} whileTap={{ scale: 0.97 }}>
            <span className="vbtn rec" aria-hidden="true"><i /></span>
            <span className="vtxt"><b>{tr("Record a voice note")}</b><small>{tr("Talk freely, then stop. It's written out for you.")}</small></span>
          </motion.button>
        )}
        {phase === "recording" && (
          <motion.div key="rec" className="voicerec" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="vtop">
              <motion.span className="vdot" animate={{ opacity: [1, 0.2, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} />
              <b className="num">{Math.floor(secs / 60)}:{pad(secs % 60)}</b>
              <span className="vmax num">/ {MAX_SECONDS / 60}:00</span>
            </div>
            <div className="vbars" ref={barsRef} aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} />)}</div>
            <div className="micactions">
              <motion.button className="btn ghost" onClick={cancel} {...tap}>{tr("Discard")}</motion.button>
              <motion.button className="btn" onClick={stop} {...tap}>{tr("Stop & transcribe")}</motion.button>
            </div>
          </motion.div>
        )}
        {phase === "sending" && (
          <motion.div key="send" className="voicesend" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <span className="spinner" aria-hidden="true" /> {tr("Transcribing your voice note…")}
          </motion.div>
        )}
        {phase === "failed" && pending && (
          <motion.div key="fail" className="voicefail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <p className="err">{err}</p>
            <div className="micactions">
              <motion.button className="btn ghost" {...tap} onClick={() => { try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ } setPending(null); setPhase("idle"); }}>{tr("Discard")}</motion.button>
              <motion.button className="btn" onClick={() => send(pending)} {...tap}>{tr("Retry")}</motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {err && phase === "idle" && <p className="err">{err}</p>}
    </div>
  );
}
