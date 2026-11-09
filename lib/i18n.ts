import { FR } from "./fr";

export type Lang = "en" | "fr";

/* Module-level so plain functions (toasts, dates, store) can translate too. The store sets these on every render. */
let LANG: Lang = "en";
let NAME = "";
let BIRTH = ""; // "YYYY-MM-DD" or ""

export function setLocaleState(lang: Lang, name: string, birth: string) {
  LANG = lang;
  NAME = name;
  BIRTH = birth;
  if (typeof document !== "undefined") document.documentElement.lang = lang;
}
export const getLang = () => LANG;
export const getName = () => NAME;
export const getBirth = () => BIRTH;
/** Locale for dates and numbers. */
export const loc = () => (LANG === "fr" ? "fr-FR" : "en-GB");

/**
 * Translate an English UI string. The English text is the key, so anything without a French entry
 * simply stays in English. `{name}` placeholders are filled from `vars`.
 */
export function tr(s: string, vars?: Record<string, string | number>) {
  let out = (LANG === "fr" && FR[s]) || s;
  if (vars) for (const k in vars) out = out.split(`{${k}}`).join(String(vars[k]));
  return out;
}

/** Numbers formatted for the current language (8 000 in French, 8,000 in English). */
export const num = (n: number) => n.toLocaleString(loc());
