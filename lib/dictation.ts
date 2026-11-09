"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/* Minimal typing for the Web Speech API (Chrome ships it as webkitSpeechRecognition). */
interface SRAlternative { transcript: string }
interface SRResult { isFinal: boolean; 0: SRAlternative; length: number }
interface SREvent { resultIndex: number; results: { length: number; [i: number]: SRResult } }
interface SRErrorEvent { error: string }
interface SR {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: SREvent) => void) | null; onerror: ((e: SRErrorEvent) => void) | null; onend: (() => void) | null;
  start(): void; stop(): void; abort(): void;
}
type SRCtor = new () => SR;

function getCtor(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const dictationSupported = () => !!getCtor();

export type DictationError = "not-allowed" | "no-speech" | "network" | "unsupported" | "other";

/**
 * Live speech-to-text. Final phrases are passed to `onFinal` as they are recognised; the phrase still being
 * spoken is exposed as `interim`. Chrome stops after a pause, so it restarts itself until `stop()` is called.
 */
export function useDictation(lang: string, onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<DictationError | null>(null);
  const recRef = useRef<SR | null>(null);
  const wantRef = useRef(false);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  const begin = useCallback(() => {
    const Ctor = getCtor();
    if (!Ctor) { setError("unsupported"); return; }
    const rec = new Ctor();
    rec.lang = lang;
    // Android Chrome repeats phrases in continuous mode, so take one phrase at a time and restart.
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0]?.transcript ?? "";
        if (r.isFinal) { if (text.trim()) finalRef.current(text.trim()); }
        else live += text;
      }
      setInterim(live);
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      setError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "not-allowed" : e.error === "network" ? "network" : "other");
      wantRef.current = false;
    };
    rec.onend = () => {
      setInterim("");
      if (wantRef.current) { try { rec.start(); return; } catch { /* fall through */ } }
      setListening(false);
    };
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch { setError("other"); wantRef.current = false; }
  }, [lang]);

  const start = useCallback(() => {
    setError(null);
    wantRef.current = true;
    begin();
  }, [begin]);

  const stop = useCallback(() => {
    wantRef.current = false;
    try { recRef.current?.stop(); } catch { /* ignore */ }
    setListening(false);
    setInterim("");
  }, []);

  useEffect(() => () => { wantRef.current = false; try { recRef.current?.abort(); } catch { /* ignore */ } }, []);

  return { listening, interim, error, start, stop, supported: dictationSupported() };
}
