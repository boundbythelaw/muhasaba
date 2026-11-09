"use client";
import confetti from "canvas-confetti";

/** Tiny pub-sub so any component can trigger floating points and toasts rendered by <FxLayer/>. */
export type FloatEvt = { id: number; x: number; y: number; value: number };
type Listener = { onFloat?: (f: FloatEvt) => void; onToast?: (msg: string) => void };
const listeners = new Set<Listener>();
let nextId = 1;

export function subscribeFx(l: Listener) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function haptic(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

export function floatPoints(x: number, y: number, value: number) {
  if (Math.abs(value) < 0.01) return;
  const evt = { id: nextId++, x, y, value };
  listeners.forEach((l) => l.onFloat?.(evt));
}

export function toast(msg: string) {
  listeners.forEach((l) => l.onToast?.(msg));
}

function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  return ["--gold", "--accent", "--good"].map((v) => cs.getPropertyValue(v).trim()).filter(Boolean).concat("#ffffff");
}

export function burst(x: number, y: number, big = false) {
  const origin = { x: x / window.innerWidth, y: y / window.innerHeight };
  const colors = themeColors();
  const base = { origin, colors, disableForReducedMotion: true, zIndex: 80 };
  if (big) {
    confetti({ ...base, particleCount: 120, spread: 100, startVelocity: 42, scalar: 1.05 });
    setTimeout(() => confetti({ ...base, particleCount: 60, spread: 140, startVelocity: 30, shapes: ["star"], scalar: 1.3 }), 180);
  } else {
    confetti({ ...base, particleCount: 45, spread: 70, startVelocity: 28, scalar: 0.9, shapes: ["square", "star"] });
  }
}

/** Centre point of a pointer event, falling back to the middle of the screen. */
export function pointOf(e?: { clientX?: number; clientY?: number } | null) {
  if (e && e.clientX && e.clientY) return { x: e.clientX, y: e.clientY };
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

/* ---------- Confirm popup ---------- */
export interface AskOpts {
  title: string;
  lines?: string[];
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}
export type AskRequest = AskOpts & { id: number; resolve: (ok: boolean) => void };
const askListeners = new Set<(r: AskRequest) => void>();

export function subscribeAsk(fn: (r: AskRequest) => void) {
  askListeners.add(fn);
  return () => {
    askListeners.delete(fn);
  };
}

/** Shows the confirm sheet and resolves true only if the user confirms. */
export function ask(opts: AskOpts): Promise<boolean> {
  if (!askListeners.size) return Promise.resolve(true);
  return new Promise((resolve) => {
    const req = { ...opts, id: nextId++, resolve };
    askListeners.forEach((l) => l(req));
  });
}
