"use client";
import { useEffect, useState } from "react";

/**
 * Journal photos. The image itself lives in IndexedDB on the phone (localStorage is far too small),
 * and a copy goes to the "Photos" folder in your Google Drive so it can appear in the day's Doc.
 * The journal entry only keeps a small reference: { id, drive? }.
 */

const DB = "muhasaba-photos";
const STORE = "photos";
export const MAX_PHOTOS = 4;
const MAX_EDGE = 1600;
const QUALITY = 0.8;

export interface PhotoRec { id: string; date: string; blob: Blob; w: number; h: number; added: number }

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: "id" }); };
      r.onsuccess = () => res(r.result);
      r.onerror = () => { dbp = null; rej(r.error); };
    });
    // Ask Chrome not to clear the photos when the phone runs low on space.
    try { void navigator.storage?.persist?.(); } catch { /* ignore */ }
  }
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((res, rej) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => res(req.result);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

export const putPhoto = (p: PhotoRec) => tx("readwrite", (s) => s.put(p)).then(() => { urlCache.delete(p.id); emit(p.id); });
export const getPhoto = (id: string) => tx<PhotoRec | undefined>("readonly", (s) => s.get(id)).catch(() => undefined);
export const deletePhoto = (id: string) => tx("readwrite", (s) => s.delete(id)).catch(() => undefined);

export const newPhotoId = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Shrink a camera photo to at most 1600 px on its long side, as JPEG (usually 150–400 KB). */
export async function compress(file: Blob): Promise<{ blob: Blob; w: number; h: number }> {
  let src: ImageBitmap | HTMLImageElement;
  try {
    src = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    src = await new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error("This file isn't an image the phone can open."));
      img.src = URL.createObjectURL(file);
    });
  }
  const sw = "naturalWidth" in src ? src.naturalWidth : src.width;
  const sh = "naturalHeight" in src ? src.naturalHeight : src.height;
  const k = Math.min(1, MAX_EDGE / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  if ("close" in src) src.close();
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't process the photo."))), "image/jpeg", QUALITY));
  return { blob, w, h };
}

export const toBase64 = (blob: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] ?? "");
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

export function fromBase64(b64: string, mime = "image/jpeg") {
  const bin = atob(b64);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return new Blob([a], { type: mime });
}

/* ---------- object URLs for display, shared between components ---------- */
const urlCache = new Map<string, string>();
const listeners = new Set<(id: string) => void>();
const emit = (id: string) => listeners.forEach((l) => l(id));

/** The local image for a photo id, or null while loading / if it isn't on this phone. */
export function usePhotoUrl(id: string) {
  const [url, setUrl] = useState<string | null | undefined>(() => urlCache.get(id));
  useEffect(() => {
    let alive = true;
    const load = () => {
      const hit = urlCache.get(id);
      if (hit) { setUrl(hit); return; }
      void getPhoto(id).then((p) => {
        if (!alive) return;
        if (!p) { setUrl(null); return; }
        const u = URL.createObjectURL(p.blob);
        urlCache.set(id, u);
        setUrl(u);
      });
    };
    load();
    const l = (x: string) => { if (x === id) load(); };
    listeners.add(l);
    return () => { alive = false; listeners.delete(l); };
  }, [id]);
  return url;
}

/* ---------- videos ---------- */

export const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
export const MAX_REC_SECONDS = 180;
export const posterId = (id: string) => id + "t";
export const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Best recording format this phone supports (MP4 plays everywhere; WebM is the fallback on older Chrome). */
export function recMime() {
  if (typeof MediaRecorder === "undefined") return "";
  const list = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
  return list.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) ?? "";
}

/**
 * A cover picture for a video: an early frame, with a play button and the length drawn on it,
 * so it reads as a video in the app and in the Google Doc.
 */
export async function makePoster(video: Blob, knownDur?: number): Promise<{ poster: Blob; dur: number; w: number; h: number }> {
  const url = URL.createObjectURL(video);
  const el = document.createElement("video");
  el.muted = true; el.playsInline = true; el.preload = "auto"; el.src = url;
  try {
    await new Promise<void>((res, rej) => {
      const to = setTimeout(() => rej(new Error("This video can't be read on this phone.")), 15000);
      el.onloadeddata = () => { clearTimeout(to); res(); };
      el.onerror = () => { clearTimeout(to); rej(new Error("This video can't be read on this phone.")); };
    });
    let dur = Number.isFinite(el.duration) ? el.duration : knownDur ?? 0;
    if (Number.isFinite(el.duration) && el.duration > 1) {
      await new Promise<void>((res) => { const to = setTimeout(res, 3000); el.onseeked = () => { clearTimeout(to); res(); }; el.currentTime = Math.min(1, el.duration / 3); });
    }
    if (!dur && knownDur) dur = knownDur;
    const vw = el.videoWidth || 1280, vh = el.videoHeight || 720;
    const k = Math.min(1, 1280 / Math.max(vw, vh));
    const w = Math.round(vw * k), h = Math.round(vh * k);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d")!;
    g.fillStyle = "#111"; g.fillRect(0, 0, w, h);
    try { g.drawImage(el, 0, 0, w, h); } catch { /* keep the dark background */ }
    // soft shade so the play button reads on bright frames
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) / 1.4);
    grd.addColorStop(0, "rgba(0,0,0,0.28)"); grd.addColorStop(1, "rgba(0,0,0,0.05)");
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    const r = Math.min(w, h) * 0.13;
    g.beginPath(); g.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    g.fillStyle = "rgba(255,255,255,0.92)"; g.fill();
    g.beginPath();
    g.moveTo(w / 2 - r * 0.32, h / 2 - r * 0.45); g.lineTo(w / 2 - r * 0.32, h / 2 + r * 0.45); g.lineTo(w / 2 + r * 0.5, h / 2); g.closePath();
    g.fillStyle = "#5A3FD6"; g.fill();
    if (dur) {
      const label = fmtDur(dur);
      const fs = Math.round(Math.min(w, h) * 0.055);
      g.font = `700 ${fs}px system-ui, sans-serif`;
      const tw = g.measureText(label).width, pad = fs * 0.5, bh = fs * 1.6;
      const x = w - tw - pad * 2 - fs * 0.6, y = h - bh - fs * 0.6;
      g.fillStyle = "rgba(0,0,0,0.62)";
      g.beginPath(); g.roundRect(x, y, tw + pad * 2, bh, bh / 2); g.fill();
      g.fillStyle = "#fff"; g.textBaseline = "middle"; g.fillText(label, x + pad, y + bh / 2);
    }
    const poster = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't make the video cover."))), "image/jpeg", 0.82));
    return { poster, dur, w, h };
  } finally {
    el.removeAttribute("src"); el.load();
    URL.revokeObjectURL(url);
  }
}

/** Save a video and its cover on the phone; returns the entry reference. */
export async function ingestVideo(file: Blob, date: string, knownDur?: number) {
  if (file.size > MAX_VIDEO_BYTES) throw new Error("bigvideo");
  const { poster, dur, w, h } = await makePoster(file, knownDur);
  const id = newPhotoId();
  await putPhoto({ id: posterId(id), date, blob: poster, w, h, added: Date.now() });
  await putPhoto({ id, date, blob: file, w, h, added: Date.now() });
  return { id, kind: "video" as const, dur: Math.round(dur) };
}
