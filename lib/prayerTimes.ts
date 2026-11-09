import { CalculationMethod, Coordinates, HighLatitudeRule, Madhab, PrayerTimes } from "adhan";
import type { PrayerId } from "./constants";
import { parseKey } from "./dates";

export type MethodId = "mwl" | "ummalqura" | "egypt" | "isna" | "france12";

export interface PrayerLocation {
  /** "conakry" | "brussels" | "makkah" | "madinah" | "gps" */
  id: string;
  label: string;
  lat: number;
  lng: number;
  /** IANA time zone the times are shown in. */
  tz: string;
  /** "auto" picks Umm al-Qura in Saudi Arabia and Muslim World League elsewhere. */
  method: MethodId | "auto";
}

export const PRESETS: PrayerLocation[] = [
  { id: "conakry", label: "Conakry", lat: 9.6412, lng: -13.5784, tz: "Africa/Conakry", method: "auto" },
  { id: "brussels", label: "Bruxelles", lat: 50.8503, lng: 4.3517, tz: "Europe/Brussels", method: "auto" },
  { id: "makkah", label: "Makkah", lat: 21.4225, lng: 39.8262, tz: "Asia/Riyadh", method: "auto" },
  { id: "madinah", label: "Madinah", lat: 24.4672, lng: 39.6111, tz: "Asia/Riyadh", method: "auto" },
];

export const DEFAULT_LOCATION = PRESETS[0];

export const METHOD_NAME: Record<MethodId, string> = {
  mwl: "Muslim World League",
  ummalqura: "Umm al-Qura (Makkah)",
  egypt: "Egyptian Authority",
  isna: "ISNA (North America)",
  france12: "UOIF 12° (France)",
};

const inSaudi = (lat: number, lng: number) => lat > 16 && lat < 32.5 && lng > 34.5 && lng < 55.7;

export function resolveMethod(loc: PrayerLocation): MethodId {
  if (loc.method !== "auto") return loc.method;
  return inSaudi(loc.lat, loc.lng) ? "ummalqura" : "mwl";
}

function params(m: MethodId) {
  switch (m) {
    case "ummalqura": return CalculationMethod.UmmAlQura();
    case "egypt": return CalculationMethod.Egyptian();
    case "isna": return CalculationMethod.NorthAmerica();
    case "france12": { const p = CalculationMethod.Other(); p.fajrAngle = 12; p.ishaAngle = 12; return p; }
    default: return CalculationMethod.MuslimWorldLeague();
  }
}

export type DayTimes = Record<PrayerId | "sunrise", Date>;

/** Prayer times for a calendar day at a location (computed on the phone, works offline). */
export function timesFor(dateKey: string, loc: PrayerLocation, asr: "standard" | "hanafi"): DayTimes {
  const coords = new Coordinates(loc.lat, loc.lng);
  const p = params(resolveMethod(loc));
  p.madhab = asr === "hanafi" ? Madhab.Hanafi : Madhab.Shafi;
  // Short summer nights in Belgium and further north need a rule for Fajr and Isha.
  if (Math.abs(loc.lat) > 45) p.highLatitudeRule = HighLatitudeRule.recommended(coords);
  const t = new PrayerTimes(coords, parseKey(dateKey), p);
  return { subh: t.fajr, sunrise: t.sunrise, dhuhr: t.dhuhr, asr: t.asr, maghrib: t.maghrib, isha: t.isha };
}

export const fmtTime = (d: Date, tz: string) => {
  try {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz });
  } catch {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  }
};

/** "1 h 12 min" / "38 min" */
export function untilText(ms: number, lang: "en" | "fr") {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60), r = m % 60;
  if (lang === "fr") return h ? `${h} h ${String(r).padStart(2, "0")}` : `${r} min`;
  return h ? `${h}h ${String(r).padStart(2, "0")}m` : `${r} min`;
}

/** The next prayer from now (rolling over to tomorrow's Subh after Isha). */
export function nextPrayer(today: string, tomorrow: string, loc: PrayerLocation, asr: "standard" | "hanafi", now = new Date()) {
  const order: PrayerId[] = ["subh", "dhuhr", "asr", "maghrib", "isha"];
  const t = timesFor(today, loc, asr);
  for (const id of order) if (t[id].getTime() > now.getTime()) return { id, at: t[id], tomorrow: false };
  return { id: "subh" as PrayerId, at: timesFor(tomorrow, loc, asr).subh, tomorrow: true };
}

/** The prayer whose time is running now (null before Subh). */
export function currentPrayer(t: DayTimes, now = new Date()): PrayerId | null {
  const order: PrayerId[] = ["isha", "maghrib", "asr", "dhuhr", "subh"];
  for (const id of order) if (t[id].getTime() <= now.getTime()) {
    if (id === "subh" && t.sunrise.getTime() <= now.getTime()) return null;
    return id;
  }
  return null;
}
