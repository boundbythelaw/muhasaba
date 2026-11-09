import { getBirth, getLang, getName, loc, tr } from "./i18n";

const pad = (n: number) => String(n).padStart(2, "0");

export const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const parseKey = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (k: string, n: number) => {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return keyOf(d);
};

export const todayKey = () => keyOf(new Date());

const HIJRI_EN = ["Muḥarram", "Ṣafar", "Rabīʿ al-Awwal", "Rabīʿ al-Ākhir", "Jumādā al-Ūlā", "Jumādā al-Ākhirah", "Rajab", "Shaʿbān", "Ramaḍān", "Shawwāl", "Dhū al-Qaʿdah", "Dhū al-Ḥijjah"];
const HIJRI_FR = ["Mouharram", "Safar", "Rabi al-Awwal", "Rabi al-Thani", "Joumada al-Oula", "Joumada al-Thania", "Rajab", "Chaabane", "Ramadan", "Chawwal", "Dhou al-Qi'da", "Dhou al-Hijja"];
const hijriMonth = (m: number) => (getLang() === "fr" ? HIJRI_FR : HIJRI_EN)[m - 1];
const AH = () => (getLang() === "fr" ? "H" : "AH");

/** Tabular Islamic calendar, used when the phone's browser has no Umm al-Qura support (can differ by a day). */
function tabularHijri(d: Date): [number, number, number] {
  let y = d.getFullYear(), m = d.getMonth() + 1;
  const day = d.getDate();
  if (m < 3) { y--; m += 12; }
  const a = Math.floor(y / 100), b = 2 - a + Math.floor(a / 4);
  const jd = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524;
  const toJd = (hy: number, hm: number, hd: number) => hd + Math.ceil(29.5 * (hm - 1)) + (hy - 1) * 354 + Math.floor((3 + 11 * hy) / 30) + 1948439 - 1;
  const hy = Math.floor((30 * (jd - 1948439) + 10646) / 10631);
  const hm = Math.min(12, Math.ceil((jd - (29 + toJd(hy, 1, 1))) / 29.5) + 1);
  return [hy, hm, jd - toJd(hy, hm, 1) + 1];
}

export function hijri(k: string): string {
  const d = parseKey(k);
  try {
    const f = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day: "numeric", month: "numeric", year: "numeric" });
    if (f.resolvedOptions().calendar.startsWith("islamic")) {
      const parts = f.formatToParts(d);
      const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? "", 10);
      const y = get("year"), m = get("month"), day = get("day");
      if (y > 1300 && y < 1700 && m >= 1 && m <= 12 && day >= 1 && day <= 30) return `${day} ${hijriMonth(m)} ${y} ${AH()}`;
    }
  } catch { /* fall through */ }
  const [y, m, day] = tabularHijri(d);
  return `${day} ${hijriMonth(m)} ${y} ${AH()}`;
}

export const longDate = (k: string) =>
  parseKey(k).toLocaleDateString(loc(), { weekday: "long", day: "numeric", month: "long" });

export const shortDate = (k: string) => parseKey(k).toLocaleDateString(loc(), { day: "numeric", month: "short" });

export function greeting(now = new Date()): { en: string; ar: string } {
  const h = now.getHours();
  const n = getName();
  const with_ = (s: string) => (n ? `${s}, ${n}` : s);
  if (h < 4) return { en: with_(tr("Late night")), ar: "قيام الليل" };
  if (h < 12) return { en: with_("Ṣabāḥ al-khayr"), ar: "صباح الخير" };
  if (h < 17) return { en: with_(tr("Good afternoon")), ar: "بارك الله فيك" };
  return { en: with_("Masāʾ al-khayr"), ar: "مساء الخير" };
}

/** Days until the next birthday and the age turned on it, or null if no birthday is set. */
export function birthday(now = new Date()) {
  const b = getBirth();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b)) return null;
  const [year, month, day] = b.split("-").map(Number);
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let next = new Date(now.getFullYear(), month - 1, day);
  if (next < t0) next = new Date(now.getFullYear() + 1, month - 1, day);
  return { daysTo: Math.round((next.getTime() - t0.getTime()) / 864e5), age: next.getFullYear() - year, month, day };
}

export const ordinal = (n: number) => {
  if (getLang() === "fr") return n === 1 ? "1er" : `${n}e`;
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

export function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}
