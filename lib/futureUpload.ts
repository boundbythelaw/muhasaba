import { getPhoto, posterId, toBase64 } from "./photos";
import { postToSheet } from "./sheetSync";
import type { PhotoRef } from "./types";

const CHUNK = 4 * 1024 * 1024;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** An upload error that says which step failed and what the script answered, so it can be shown. */
const fail = (step: string, r: { error?: string; status?: number }) => new Error(`${r.error || "upload"}|${step}${r.status ? " · HTTP " + r.status : ""}`);

/** Upload one photo straight into the "Future me / Sealed" folder. Returns its Drive id. */
async function sendPhoto(url: string, id: string, date: string): Promise<string> {
  const rec = await getPhoto(id);
  if (!rec) throw new Error("missing");
  const data = await toBase64(rec.blob);
  let r = { ok: false } as Awaited<ReturnType<typeof postToSheet>>;
  for (let k = 0; k < 3; k++) {
    if (k) await wait(k * 2500);
    r = await postToSheet(url, { photo: { id, date, mime: rec.blob.type || "image/jpeg", data, future: true } }, true);
    if (r.ok && r.drive) return r.drive;
    if (r.error === "offline") break;
  }
  throw fail(id.endsWith("t") ? "video cover" : "photo", r);
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
      if (res.error === "offline" || misses >= 5) throw fail(`video at ${Math.round(((typeof res.next === "number" ? res.next : 0) / total) * 100)}%`, res);
      misses++;
      await wait(misses * 2000);
      chunk = chunk > 3 * 1024 * 1024 ? 3 * 1024 * 1024 : chunk > 1024 * 1024 ? 1024 * 1024 : 512 * 1024;
      res = await postToSheet(url, { video: base }, true);
      continue;
    }
    if (res.drive) return res.drive;
    if (typeof res.next !== "number") throw fail("video (script reply had no progress)", { error: "script" });
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
