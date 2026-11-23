import { getPhoto, posterId, toBase64 } from "./photos";
import { postToSheet } from "./sheetSync";
import type { PhotoRef } from "./types";

const CHUNK = 8 * 1024 * 1024;

/** Upload one photo straight into the "Future me / Sealed" folder. Returns its Drive id. */
async function sendPhoto(url: string, id: string, date: string): Promise<string> {
  const rec = await getPhoto(id);
  if (!rec) throw new Error("missing");
  const r = await postToSheet(url, { photo: { id, date, mime: rec.blob.type || "image/jpeg", data: await toBase64(rec.blob), future: true } }, true);
  if (r.ok && r.drive) return r.drive;
  throw new Error(r.error || "upload");
}

/** Upload a video in pieces (resumable); smaller pieces when the connection is weak. */
async function sendVideo(url: string, id: string, date: string, onPart: (f: number) => void): Promise<string> {
  const rec = await getPhoto(id);
  if (!rec) throw new Error("missing");
  const total = rec.blob.size, mime = rec.blob.type || "video/mp4";
  const base = { id, date, mime, total, future: true };
  let res = await postToSheet(url, { video: base }, true);
  let chunk = CHUNK, misses = 0;
  for (let guard = 0; guard < 2000; guard++) {
    if (!res.ok) {
      if (res.error === "offline" || misses >= 4) throw new Error(res.error || "upload");
      misses++;
      chunk = chunk > 3 * 1024 * 1024 ? 3 * 1024 * 1024 : chunk > 1024 * 1024 ? 1024 * 1024 : 512 * 1024;
      res = await postToSheet(url, { video: base }, true);
      continue;
    }
    if (res.drive) return res.drive;
    if (typeof res.next !== "number") throw new Error("script");
    onPart(res.next / total);
    const piece = rec.blob.slice(res.next, Math.min(total, res.next + chunk));
    res = await postToSheet(url, { video: { ...base, offset: res.next, data: await toBase64(piece) } }, true);
    if (res.ok) misses = 0;
  }
  throw new Error("stalled");
}

/**
 * Upload whatever of a letter's media isn't in Drive yet. `save` is called after each file so a dropped
 * connection never re-sends what already made it.
 */
export async function uploadLetterMedia(url: string, date: string, media: PhotoRef[], save: (m: PhotoRef[]) => void, progress: (i: number, f: number) => void) {
  const list = media.map((m) => ({ ...m }));
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    progress(i, 0);
    if (m.kind === "video") {
      if (!m.poster) { m.poster = await sendPhoto(url, posterId(m.id), date); save(list); }
      if (!m.drive) { m.drive = await sendVideo(url, m.id, date, (f) => progress(i, f)); save(list); }
    } else if (!m.drive) { m.drive = await sendPhoto(url, m.id, date); save(list); }
    progress(i, 1);
  }
  return list;
}

/** What the script stores for the letter: a photo is its Drive id; a video is { v, p, d }. */
export const asSheetMedia = (m: PhotoRef[]) => m.map((x) => (x.kind === "video" ? { v: x.drive, p: x.poster, d: x.dur ?? 0 } : x.drive));
