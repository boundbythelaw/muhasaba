/**
 * Muhasaba → Google Sheets + Google Docs
 *
 * • Every day you log in the app becomes one row in the "Log" tab (matched by date, never duplicated).
 * • Your journal for each day becomes its own Google Doc in a Drive folder called "Muhasaba Journal",
 *   spelling-corrected and lightly polished by AI, with your original notes kept at the bottom.
 * • The AI reads the day and labels it Good day / Hard but good / Hard day. The Log and Dashboard colour it.
 * • Photos you attach to journal entries are saved in "Muhasaba Journal/Photos" and laid out in that day's Doc.
 * • Videos go to "Muhasaba Journal/Videos" (uploaded in pieces, so a weak connection can resume). The Doc shows
 *   a cover picture with a ▶ link that opens the video in Drive.
 *
 * • An "Insights" tab rebuilt every night: weekdays, best/worst days, how you respond to bad days, what comes with
 *   them (sleep, phone, slips…), salah per prayer, ḥifẓ pace, work, walking, months.
 * • A reminder email at 22:00 when something is missing, and a weekly letter every Sunday evening.
 *
 * Setup:
 *   1. Paste this file, save, pick `setup` and press Run. Allow access (Sheets, Docs, Drive, external requests).
 *   2. In the sheet: Muhasaba menu → Set AI key… and paste a Gemini key (free, aistudio.google.com/apikey)
 *      or a Claude API key (console.anthropic.com).
 *   3. Deploy → Manage deployments → Edit → Version: New version → Deploy. The /exec link stays the same.
 */

const LOG = "Log";
const DASH = "Dashboard";
const STORE = "_journal";
const FOLDER_NAME = "Muhasaba Journal";
const MAX_ROWS = 2000;
/** A journal is polished automatically once you've stopped writing for this long. */
const SETTLE_MINUTES = 30;

const COLUMNS = [
  // [header, key, width]
  ["Date", "date", 110],
  ["Day", "day", 52],
  ["Score", "score", 64],
  ["Day type", "dayType", 124],
  ["Salah /40", "salah", 76],
  ["Qur'an /30", "quran", 80],
  ["Work /20", "work", 72],
  ["Walk /10", "walk", 70],
  ["Subh", "subh", 112],
  ["Dhuhr", "dhuhr", 112],
  ["Asr", "asr", 112],
  ["Maghrib", "maghrib", 112],
  ["Isha", "isha", 112],
  ["Why late / missed", "reasons", 220],
  ["Excused", "excused", 66],
  ["Pages memorised", "pages", 84],
  ["Portion", "portion", 82],
  ["Minutes", "minutes", 70],
  ["Difficulty", "difficulty", 84],
  ["Preview", "preview", 66],
  ["1 juz", "juz", 56],
  ["Mulk (Subh)", "mulkSubh", 84],
  ["Mulk (Maghrib)", "mulkMaghrib", 100],
  ["Revised pages", "revised", 70],
  ["Revision", "revRanges", 120],
  ["Hours", "hours", 60],
  ["Topics", "topics", 200],
  ["What moved forward", "note", 280],
  ["Steps", "steps", 76],
  ["Slept", "slept", 62],
  ["Woke", "woke", 62],
  ["Sleep (h)", "sleepH", 66],
  ["Phone", "phone", 70],
  ["Energy", "energy", 62],
  ["Mood", "mood", 58],
  ["Slipped", "slip", 66],
  ["Tawbah", "tawbah", 66],
  ["Check-in ✓", "checkin", 76],
  ["Bonus ✦", "bonus", 70],
  ["Bonus deeds", "bonusList", 220],
  ["Journal", "journal", 96],
  ["The day in a line", "summary", 300],
  ["Last update", "updated", 140],
];
/** Bumped whenever COLUMNS change. The app re-sends every day when it sees a new number. */
const SCHEMA = 2;
const INSIGHTS = "Insights";
/** Local hour (in the app's time zone) for the nightly reminder email, and the weekly letter on Sunday. */
const REMIND_HOUR = 22;
const LETTER_HOUR = 20;

/** Columns the script fills itself; app updates must not wipe them. */
const MANAGED = ["dayType", "journal", "summary"];
const NCOL = COLUMNS.length;
const col = (key) => COLUMNS.findIndex((c) => c[1] === key) + 1;
function colLetter(n) {
  let s = "";
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}
const letter = (key) => colLetter(col(key));

const PRAYER_LABELS = ["Before takbīr", "Mosque (late)", "No mosque", "Excused"];
const DIFFICULTY = ["Easy", "Normal", "Hard"];
const VERDICT = {
  good: { label: "Good day", fill: "#D7F2E4", ink: "#146C4B", dot: "🟢" },
  hard_good: { label: "Hard but good", fill: "#FFF0C7", ink: "#8A5A00", dot: "🟡" },
  hard: { label: "Hard day", fill: "#FBDCD5", ink: "#A3341F", dot: "🔴" },
};

const C = {
  night: "#1B1F4B", violet: "#5A3FD6", violetSoft: "#ECE7FF", gold: "#E9A23B", goldSoft: "#FCEFD3",
  green: "#1E8A63", greenSoft: "#DDF3EA", amberSoft: "#FFF1D6", red: "#C2452D", redSoft: "#FBE3DD", band: "#F7F5FC",
};

/* ================================================================== web endpoints */

function doGet() {
  const sh = SpreadsheetApp.getActive().getSheetByName(LOG);
  return json({ ok: true, app: "muhasaba", days: sh ? lastDataRow(sh) - 1 : 0, sheet: SpreadsheetApp.getActive().getName(), ai: aiProvider() || "none" });
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || "{}"); } catch (err) { return json({ ok: false, error: "Bad request" }); }
  // Voice notes don't touch the sheet, so they skip the lock and can run while other days sync.
  if (body.transcribe) {
    try { return json(Object.assign({ ok: true }, transcribe(body.transcribe.audio, body.transcribe.mime))); }
    catch (err) { return json({ ok: false, error: String(err && err.message ? err.message : err) }); }
  }
  // Photos only touch Drive, so they skip the lock too.
  if (body.photo || body.photoGet || body.photoDelete || body.video) {
    try {
      if (body.video) return json(Object.assign({ ok: true }, videoPart(body.video)));
      if (body.photo) return json(Object.assign({ ok: true }, savePhoto(body.photo)));
      if (body.photoGet) return json(Object.assign({ ok: true }, readPhoto(body.photoGet)));
      trashPhoto(body.photoDelete);
      return json({ ok: true });
    } catch (err) { return json({ ok: false, error: String(err && err.message ? err.message : err) }); }
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  let processDate = null;
  let reply;
  try {
    const sheet = ensureLog();
    if (!SpreadsheetApp.getActive().getSheetByName(DASH)) buildDashboard();
    if (body.ping) {
      return json({ ok: true, app: "muhasaba", sheet: SpreadsheetApp.getActive().getName(), days: lastDataRow(sheet) - 1, ai: aiProvider() || "none", schema: SCHEMA });
    }
    if (body.repolish) {
      lock.releaseLock();
      const r = repolishAll(3);
      return json({ ok: true, queued: r.queued, done: r.done });
    }
    const rows = Array.isArray(body.rows) ? body.rows : [];
    const saved = upsert(sheet, rows);
    rows.forEach(storeJournal);
    processDate = typeof body.process === "string" ? body.process : null;
    reply = { ok: true, saved, schema: SCHEMA };
    rememberContext(rows);
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
  // Polishing can take a few seconds, so it runs outside the lock.
  if (processDate) {
    try { processDay(processDate); } catch (err) { reply.processError = String(err && err.message ? err.message : err); }
  }
  const dates = [].concat((body.rows || []).map((r) => r && r.date), body.lookup || [], processDate || []).filter(Boolean);
  reply.docs = docInfo(dates);
  return json(reply);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Formula argument separator for this spreadsheet's locale. Sheets set to French, German, etc. use ";" instead of ",".
 * Detected once by test-writing a formula, then cached per locale.
 */
function sep() {
  const ss = SpreadsheetApp.getActive();
  const p = PropertiesService.getScriptProperties();
  const key = "SEP_" + ss.getSpreadsheetLocale();
  const cached = p.getProperty(key);
  if (cached) return cached;
  let tmp = ss.getSheetByName("_sep");
  if (!tmp) tmp = ss.insertSheet("_sep");
  const cell = tmp.getRange("A1");
  cell.setFormula("=SUM(1,2)");
  SpreadsheetApp.flush();
  const ok = cell.getDisplayValue() === "3";
  ss.deleteSheet(tmp);
  const v = ok ? "," : ";";
  p.setProperty(key, v);
  return v;
}

/** Rewrites a formula written with commas into this sheet's separator, leaving text in quotes untouched. */
function F(formula) {
  if (sep() === ",") return formula;
  return formula.replace(/("[^"]*")|,/g, (m, q) => (q ? q : ";"));
}

/** Last row that has a date. getLastRow() can't be used: the checkbox columns fill every row. */
function lastDataRow(sh) {
  const n = sh.getMaxRows() - 1;
  if (n < 1) return 1;
  const v = sh.getRange(2, 1, n, 1).getValues();
  for (let i = v.length - 1; i >= 0; i--) if (v[i][0] !== "" && v[i][0] !== null) return i + 2;
  return 1;
}

function dateKey(v, tz) {
  return v instanceof Date ? Utilities.formatDate(v, tz, "yyyy-MM-dd") : String(v || "");
}

function rowIndex(sheet) {
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const last = lastDataRow(sheet);
  const index = {};
  if (last > 1) sheet.getRange(2, 1, last - 1, 1).getValues().forEach((v, i) => { const k = dateKey(v[0], tz); if (k) index[k] = i + 2; });
  return { index, last };
}

/* ================================================================== Log rows */

function upsert(sheet, rows) {
  const valid = rows.filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.date));
  if (!valid.length) return 0;
  const { index, last } = rowIndex(sheet);
  const now = new Date();
  const appended = [];
  const saved = savedManaged();
  valid.forEach((r) => {
    const values = toValues(r, now);
    const at = index[r.date];
    const keep = saved[r.date];
    if (at) {
      const range = sheet.getRange(at, 1, 1, NCOL);
      const formulas = range.getFormulas()[0];
      const current = range.getValues()[0];
      MANAGED.forEach((k) => { const i = col(k) - 1; values[i] = formulas[i] || current[i] || (keep ? keep[k] : ""); });
      range.setValues([values]);
    } else {
      // A re-sent day gets its rating, Doc link and summary back from what was already polished. No AI call.
      if (keep) MANAGED.forEach((k) => { values[col(k) - 1] = keep[k]; });
      appended.push(values);
    }
  });
  if (appended.length) {
    const start = last + 1;
    if (start + appended.length - 1 > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), appended.length + 100);
    sheet.getRange(start, 1, appended.length, NCOL).setValues(appended);
  }
  const n = lastDataRow(sheet) - 1;
  if (n > 1) sheet.getRange(2, 1, n, NCOL).sort({ column: 1, ascending: true });
  return valid.length;
}

function toValues(r, now) {
  const [y, m, d] = r.date.split("-").map(Number);
  return COLUMNS.map(([, key]) => {
    if (key === "date") return new Date(y, m - 1, d);
    if (key === "updated") return now;
    if (MANAGED.indexOf(key) >= 0) return "";
    const v = r[key];
    if (typeof v === "boolean") return v;
    if (v === null || v === undefined) return "";
    return v;
  });
}

/** Day type, Doc link and summary for every day already polished, read from the hidden journal store. */
function savedManaged() {
  const out = {};
  const sh = SpreadsheetApp.getActive().getSheetByName(STORE);
  if (!sh || sh.getLastRow() < 2) return out;
  sh.getRange(2, 1, sh.getLastRow() - 1, SCOLS.length).getValues().forEach((r) => {
    const date = String(r[S("date") - 1]), docId = r[S("docId") - 1];
    if (!docId) return;
    const verdict = r[S("verdict") - 1], title = r[S("title") - 1], summary = r[S("summary") - 1];
    out[date] = {
      dayType: verdict && VERDICT[verdict] ? VERDICT[verdict].label : "",
      journal: F(`=HYPERLINK("https://docs.google.com/document/d/${docId}/edit","Open ↗")`),
      summary: title ? `${title}. ${summary}` : summary || "",
    };
  });
  return out;
}

/** Mark every saved journal to be polished again. A few run now; the 15-minute trigger does the rest. */
function repolishAll(runNow) {
  const sh = SpreadsheetApp.getActive().getSheetByName(STORE);
  if (!sh || sh.getLastRow() < 2) return { queued: 0, done: 0 };
  const n = sh.getLastRow() - 1;
  const rows = sh.getRange(2, 1, n, SCOLS.length).getValues();
  let queued = 0;
  rows.forEach((r, i) => {
    if (!r[S("hash") - 1]) return;
    sh.getRange(i + 2, S("processedHash")).setValue("");
    sh.getRange(i + 2, S("changedAt")).setValue(new Date(0));
    queued++;
  });
  let done = 0;
  const start = Date.now();
  for (let i = 0; i < rows.length && done < runNow && Date.now() - start < 60000; i++) {
    if (!rows[i][S("hash") - 1]) continue;
    try { processDay(String(rows[i][0])); done++; } catch (err) { console.error(err); }
  }
  return { queued, done };
}

function repolishAllMenu() {
  const r = repolishAll(3);
  SpreadsheetApp.getActive().toast(`${r.done} polished now, ${Math.max(0, r.queued - r.done)} more over the next hour.`, "Muhasaba");
}

/** Write the script-managed cells (day type, doc link, summary) for one date. */
function setManaged(date, verdict, url, summary) {
  const sheet = ensureLog();
  const { index } = rowIndex(sheet);
  const r = index[date];
  if (!r) return;
  sheet.getRange(r, col("dayType")).setValue(verdict && VERDICT[verdict] ? VERDICT[verdict].label : "");
  if (url) sheet.getRange(r, col("journal")).setFormula(F(`=HYPERLINK("${url}","Open ↗")`));
  sheet.getRange(r, col("summary")).setValue(summary || "");
}

/* ================================================================== journal store */

const SCOLS = ["date", "entries", "shukr", "meta", "hash", "processedHash", "docId", "changedAt", "verdict", "title", "summary", "error"];
const S = (k) => SCOLS.indexOf(k) + 1;

function storeSheet() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(STORE);
  if (!sh) {
    sh = ss.insertSheet(STORE);
    sh.getRange(1, 1, 1, SCOLS.length).setValues([SCOLS]).setFontWeight("bold");
    sh.hideSheet();
  }
  return sh;
}

function storeFind(sh, date) {
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const v = sh.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (let i = 0; i < v.length; i++) if (v[i][0] === date) return i + 2;
  return 0;
}

function storeRead(sh, r) {
  const v = sh.getRange(r, 1, 1, SCOLS.length).getValues()[0];
  const o = {};
  SCOLS.forEach((k, i) => (o[k] = v[i]));
  return o;
}

function md5(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .map((b) => ((b + 256) % 256).toString(16).padStart(2, "0")).join("");
}

function storeJournal(row) {
  if (!row || !row.date) return;
  const entries = Array.isArray(row.journal) ? row.journal.filter((x) => x && (String(x.text || "").trim() || (Array.isArray(x.photos) && x.photos.length))) : [];
  const shukr = String(row.shukr || "");
  const sh = storeSheet();
  let r = storeFind(sh, row.date);
  if (!entries.length && !shukr.trim() && !r) return;
  const entriesJson = JSON.stringify(entries.map((x) => {
    const photos = Array.isArray(x.photos) ? x.photos.map(mediaItem).filter(Boolean) : [];
    const e = { t: String(x.t || ""), text: String(x.text || "") };
    return photos.length ? Object.assign(e, { photos: photos }) : e;
  }));
  const hash = md5(entriesJson + "|" + shukr);
  const meta = JSON.stringify({ longDate: row.longDate || row.date, hijri: row.hijri || "", score: row.score, bonus: row.bonus, bonusList: row.bonusList, salah: row.salah, quran: row.quran, work: row.work, walk: row.walk, portion: row.portion, pages: row.pages, hours: row.hours, steps: row.steps });
  if (!r) {
    r = sh.getLastRow() + 1;
    sh.getRange(r, S("date")).setNumberFormat("@").setValue(row.date);
  }
  const cur = storeRead(sh, r);
  sh.getRange(r, S("meta")).setValue(meta);
  if (cur.hash !== hash) {
    sh.getRange(r, S("entries"), 1, 2).setValues([[entriesJson, shukr]]);
    sh.getRange(r, S("hash")).setValue(hash);
    sh.getRange(r, S("changedAt")).setValue(new Date());
  }
}

function docInfo(dates) {
  const out = {};
  if (!dates.length) return out;
  const sh = SpreadsheetApp.getActive().getSheetByName(STORE);
  if (!sh) return out;
  const uniq = dates.filter((d, i) => dates.indexOf(d) === i);
  uniq.forEach((d) => {
    const r = storeFind(sh, d);
    if (!r) return;
    const o = storeRead(sh, r);
    out[d] = {
      url: o.docId ? `https://docs.google.com/document/d/${o.docId}/edit` : "",
      verdict: o.verdict || "",
      title: o.title || "",
      summary: o.summary || "",
      pending: !!o.hash && o.hash !== o.processedHash,
      error: String(o.error || ""),
    };
  });
  return out;
}

/* ================================================================== polishing */

/** Time-driven trigger: polish journals you've stopped editing. */
function processJournals() {
  const sh = SpreadsheetApp.getActive().getSheetByName(STORE);
  if (!sh || sh.getLastRow() < 2) return;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, SCOLS.length).getValues();
  const now = Date.now();
  let done = 0;
  for (let i = 0; i < rows.length && done < 6; i++) {
    const [date, , , , hash, processedHash, , changedAt] = rows[i];
    if (!hash || hash === processedHash) continue;
    if (changedAt instanceof Date && now - changedAt.getTime() < SETTLE_MINUTES * 60000) continue;
    try { processDay(String(date)); done++; } catch (err) { console.error(date, err); }
  }
}

/** Menu: polish everything waiting, right now. */
function processAllNow() {
  const sh = SpreadsheetApp.getActive().getSheetByName(STORE);
  if (!sh || sh.getLastRow() < 2) return;
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, SCOLS.length).getValues();
  let n = 0;
  rows.forEach((r) => { if (r[4] && r[4] !== r[5]) { processDay(String(r[0])); n++; } });
  SpreadsheetApp.getActive().toast(n ? `${n} day${n > 1 ? "s" : ""} polished and saved to Docs.` : "Nothing waiting.", "Muhasaba");
}

function processDay(date) {
  const sh = storeSheet();
  const r = storeFind(sh, date);
  if (!r) return null;
  const o = storeRead(sh, r);
  const entries = JSON.parse(o.entries || "[]");
  const meta = JSON.parse(o.meta || "{}");
  const shukr = String(o.shukr || "");
  if (!entries.length && !shukr.trim()) return null;

  // The AI only sees entries with words; photo-only entries keep their place in the day.
  const forAI = entries.map((e, i) => ({ i: i, t: e.t, text: String(e.text || "") })).filter((e) => e.text.trim());
  let ai = null, aiError = "";
  try { ai = polishWithAI(forAI.map((e) => ({ t: e.t, text: e.text })), shukr, meta); }
  catch (err) { aiError = String(err && err.message ? err.message : err); console.error("AI failed", err); }
  const polished = entries.map((e) => ({ t: e.t, text: String(e.text || ""), photos: e.photos || [] }));
  if (ai && Array.isArray(ai.entries) && ai.entries.length === forAI.length) {
    forAI.forEach((f, k) => { const x = ai.entries[k]; if (x && String(x.text || "").trim()) polished[f.i].text = String(x.text); });
  }
  // If the AI call failed, keep the previous rating and summary instead of wiping them, and try again later.
  const keepOld = !ai && !!aiError;
  const verdict = ai && VERDICT[ai.verdict] ? ai.verdict : keepOld ? String(o.verdict || "") : "";
  const title = ai ? ai.title || "" : keepOld ? String(o.title || "") : "";
  const summary = ai ? ai.summary || "" : keepOld ? String(o.summary || "") : "";
  const shukrOut = (ai && ai.shukr) || shukr;

  MEDIA_ERRORS.length = 0;
  const docId = writeDoc(o.docId, date, meta, entries, polished, shukr, shukrOut, verdict, title, summary, !!ai);
  const problems = [aiError && "AI polish failed: " + aiError.slice(0, 200)].concat(MEDIA_ERRORS.slice(0, 2)).filter(Boolean).join(" · ");
  if (!keepOld) sh.getRange(r, S("processedHash")).setValue(o.hash); // a failed AI call stays pending, so it retries
  sh.getRange(r, S("docId")).setValue(docId);
  sh.getRange(r, S("verdict"), 1, 4).setValues([[verdict, title, summary, problems]]);
  setManaged(date, verdict, `https://docs.google.com/document/d/${docId}/edit`, title ? `${title}. ${summary}` : summary);
  if (problems) console.warn(date, problems);
  return docId;
}

/* ------------------------------------------------------------------ AI */

function aiProvider() {
  const p = PropertiesService.getScriptProperties();
  if (p.getProperty("ANTHROPIC_API_KEY")) return "claude";
  if (p.getProperty("GEMINI_API_KEY")) return "gemini";
  return null;
}

function buildPrompt(entries, shukr, meta) {
  return [
    "You edit the private daily journal of Mohamed Diallo, 20, a young Muslim who is memorising the Qur'an and building a business called MuslimPreneur.",
    "He types quickly on his phone and makes mistakes. For each entry:",
    "- Fix spelling, grammar and punctuation, and make it read clearly and naturally.",
    "- Keep his voice, first person, his meaning and every fact. Never add events, feelings or details he did not write.",
    "- Keep the language he wrote in (English, French or mixed). Keep Islamic terms as he uses them (Subh, Dhuhr, Asr, Maghrib, Isha, takbīr, juz, hifz, in shā' Allāh, al-ḥamdu lillāh).",
    "- Return exactly one polished entry per input entry, in the same order, with the same time.",
    "",
    "Then judge the day as a whole, mainly from the tone and content of his writing (the scores are secondary context):",
    '- "good": mostly positive, productive or peaceful.',
    '- "hard_good": difficult, tiring or painful, but he pushed through, learned, grew or it ended well.',
    '- "hard": mostly struggle, low mood, or things went badly, without a positive turn.',
    "Give a title of at most 6 words, and a summary of 1–2 warm sentences written to him (\"You…\"), in the language he mostly wrote in.",
    "",
    `Date: ${meta.longDate || ""} (${meta.hijri || ""}). App score: ${meta.score ?? "?"}/100 (salah ${meta.salah ?? "?"}/40, Qur'an ${meta.quran ?? "?"}/30, work ${meta.work ?? "?"}/20, walk ${meta.walk ?? "?"}/10).${meta.bonusList ? " Extra voluntary deeds: " + meta.bonusList + "." : ""}`,
    "",
    "Entries (JSON):",
    JSON.stringify(entries),
    shukr.trim() ? `\nGratitude note: ${JSON.stringify(shukr)}` : "",
    "",
    'Reply with JSON only, no markdown: {"entries":[{"t":"HH:MM","text":"..."}],"shukr":"polished gratitude note or empty string","verdict":"good|hard_good|hard","title":"...","summary":"..."}',
  ].join("\n");
}

function parseJson(text) {
  const s = String(text || "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("AI reply had no JSON");
  return JSON.parse(s.slice(a, b + 1));
}

function polishWithAI(entries, shukr, meta) {
  if (!aiProvider()) return null;
  return parseJson(callAI(buildPrompt(entries, shukr, meta), 16000));
}

/** Send one prompt to whichever AI key is set (Claude or Gemini) and return its text. */
function callAI(prompt, maxTokens) {
  const provider = aiProvider();
  if (!provider) throw new Error("No AI key set (Muhasaba menu → Set AI key…)");
  const p = PropertiesService.getScriptProperties();
  if (provider === "claude") {
    const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post", contentType: "application/json", muteHttpExceptions: true,
      headers: { "x-api-key": p.getProperty("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" },
      payload: JSON.stringify({ model: p.getProperty("CLAUDE_MODEL") || "claude-haiku-5-5", max_tokens: maxTokens || 4000, messages: [{ role: "user", content: prompt }] }),
    });
    if (res.getResponseCode() !== 200) throw new Error("Claude " + res.getResponseCode() + ": " + res.getContentText().slice(0, 300));
    const j = JSON.parse(res.getContentText());
    return (j.content || []).map((c) => c.text || "").join("");
  }
  const key = p.getProperty("GEMINI_API_KEY");
  const model = geminiModel(key);
  const res = UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: "post", contentType: "application/json", muteHttpExceptions: true,
    payload: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, responseMimeType: "application/json" } }),
  });
  if (res.getResponseCode() !== 200) {
    p.deleteProperty("GEMINI_MODEL_AUTO");
    throw new Error("Gemini " + res.getResponseCode() + ": " + res.getContentText().slice(0, 300));
  }
  const j = JSON.parse(res.getContentText());
  const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
  return parts.map((x) => x.text || "").join("");
}

/* ------------------------------------------------------------------ voice notes (OpenAI speech-to-text) */

/** Words Whisper should expect, so religious and personal terms come out spelled right. */
const VOICE_VOCAB = "Alhamdulillah, SubhanAllah, Bismillah, In sha Allah, Masha Allah, Subh, Fajr, Dhuhr, Asr, Maghrib, Isha, takbir, tahajjud, witr, duha, adhkar, rawatib, juz, hifz, Qur'an, Mushaf, Al-Mulk, masjid, MuslimPreneur, LinkedIn, Conakry, Bruxelles.";

function transcribe(audioB64, mime) {
  const p = PropertiesService.getScriptProperties();
  const key = p.getProperty("OPENAI_API_KEY");
  if (!key) throw new Error("No voice key yet. In your sheet: Muhasaba menu → Set AI key… and paste your OpenAI key (starts with sk-).");
  if (!audioB64) throw new Error("The recording was empty.");
  const type = String(mime || "audio/webm").split(";")[0];
  const ext = type.indexOf("mp4") >= 0 || type.indexOf("m4a") >= 0 ? "m4a" : type.indexOf("ogg") >= 0 ? "ogg" : type.indexOf("wav") >= 0 ? "wav" : "webm";
  const blob = Utilities.newBlob(Utilities.base64Decode(audioB64), type, "voice-note." + ext);
  const models = [p.getProperty("OPENAI_STT_MODEL"), "gpt-4o-transcribe", "whisper-1"].filter(Boolean);
  let last = "";
  for (const model of models) {
    const res = UrlFetchApp.fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "post", muteHttpExceptions: true,
      headers: { Authorization: "Bearer " + key },
      payload: { file: blob, model: model, prompt: VOICE_VOCAB, response_format: "json" },
    });
    const code = res.getResponseCode(), text = res.getContentText();
    if (code === 200) {
      p.setProperty("OPENAI_STT_MODEL", model);
      return { text: String(JSON.parse(text).text || "").trim(), model: model };
    }
    last = `OpenAI ${code}: ${text.slice(0, 240)}`;
    // Try the next model only when this one isn't available to the key.
    if (!(code === 404 || (code === 400 && /model/i.test(text)) || code === 403)) break;
    p.deleteProperty("OPENAI_STT_MODEL");
  }
  throw new Error(last || "Transcription failed");
}

/** Picks the newest general "Flash" model your key can use, so model renames never break the script. */
function geminiModel(key) {
  const p = PropertiesService.getScriptProperties();
  const fixed = p.getProperty("GEMINI_MODEL");
  if (fixed) return fixed.startsWith("models/") ? fixed : "models/" + fixed;
  const cached = p.getProperty("GEMINI_MODEL_AUTO");
  if (cached) return cached;
  const res = UrlFetchApp.fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error("Gemini key rejected: " + res.getContentText().slice(0, 200));
  const models = (JSON.parse(res.getContentText()).models || [])
    .filter((m) => (m.supportedGenerationMethods || []).indexOf("generateContent") >= 0)
    .map((m) => m.name)
    .filter((n) => /gemini-[\d.]+-flash/.test(n) && !/(image|tts|audio|live|embedding|exp|thinking|lite)/.test(n));
  const ver = (n) => parseFloat((n.match(/gemini-([\d.]+)/) || [0, 0])[1]);
  models.sort((a, b) => ver(b) - ver(a) || (/preview/.test(a) ? 1 : 0) - (/preview/.test(b) ? 1 : 0) || a.length - b.length);
  const pick = models[0] || "models/gemini-2.5-flash";
  p.setProperty("GEMINI_MODEL_AUTO", pick);
  return pick;
}

/* ------------------------------------------------------------------ Google Doc */

function journalFolder() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty("FOLDER_ID");
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* deleted; recreate */ } }
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  const f = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
  p.setProperty("FOLDER_ID", f.getId());
  return f;
}

function writeDoc(docId, date, meta, original, polished, shukrRaw, shukrOut, verdict, title, summary, usedAI) {
  let doc = null;
  if (docId) { try { doc = DocumentApp.openById(docId); } catch (e) { doc = null; } }
  const name = `Muhasaba · ${date} · ${meta.longDate || ""}`.trim();
  if (!doc) {
    doc = DocumentApp.create(name);
    const file = DriveApp.getFileById(doc.getId());
    file.moveTo(journalFolder());
  } else {
    doc.setName(name);
  }
  const body = doc.getBody();
  body.clear();
  body.setMarginTop(48).setMarginBottom(48).setMarginLeft(56).setMarginRight(56);
  const base = {};
  base[DocumentApp.Attribute.FONT_FAMILY] = "Lora";
  base[DocumentApp.Attribute.FONT_SIZE] = 11.5;
  base[DocumentApp.Attribute.LINE_SPACING] = 1.4;
  base[DocumentApp.Attribute.FOREGROUND_COLOR] = "#1C1838";

  const first = body.getParagraphs()[0];
  first.setText(meta.longDate || date);
  first.setHeading(DocumentApp.ParagraphHeading.TITLE)
    .setAttributes(Object.assign({}, base, { [DocumentApp.Attribute.FONT_SIZE]: 26, [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FONT_FAMILY]: "Poppins" }));

  const all = [].concat.apply([], polished.map((e) => (e.photos || []).map(mediaItem).filter(Boolean)));
  const nPh = all.filter((m) => typeof m === "string").length, nVid = all.length - nPh;
  const sub = [meta.hijri, nPh ? `📷 ${nPh}` : "", nVid ? `🎬 ${nVid}` : "", meta.score != null ? `Score ${Math.round(meta.score)}/100` : "", meta.portion ? `Ḥifẓ pages ${meta.portion}` : "", meta.hours ? `${meta.hours}h MuslimPreneur` : "", meta.steps ? `${Number(meta.steps).toLocaleString()} steps` : ""]
    .filter(Boolean).join("  ·  ");
  body.appendParagraph(sub).setAttributes(Object.assign({}, base, { [DocumentApp.Attribute.FONT_SIZE]: 10, [DocumentApp.Attribute.FOREGROUND_COLOR]: "#6A6688", [DocumentApp.Attribute.FONT_FAMILY]: "Roboto" }));

  if (verdict) {
    const v = VERDICT[verdict];
    const t = body.appendTable([[`${v.dot}  ${v.label.toUpperCase()}${title ? "  —  " + title : ""}`]]);
    t.setBorderWidth(0);
    const cell = t.getCell(0, 0).setBackgroundColor(v.fill).setPaddingTop(12).setPaddingBottom(12).setPaddingLeft(14).setPaddingRight(14);
    cell.getChild(0).asParagraph().setAttributes(Object.assign({}, base, { [DocumentApp.Attribute.FOREGROUND_COLOR]: v.ink, [DocumentApp.Attribute.FONT_SIZE]: 11.5, [DocumentApp.Attribute.BOLD]: true }));
    if (summary) cell.appendParagraph(summary).setAttributes(Object.assign({}, base, { [DocumentApp.Attribute.FOREGROUND_COLOR]: v.ink, [DocumentApp.Attribute.FONT_SIZE]: 11, [DocumentApp.Attribute.BOLD]: false }));
  } else if (!usedAI) {
    body.appendParagraph("Not rated yet. Add an AI key from the Muhasaba menu in your sheet to get spelling fixes and a day rating.")
      .setAttributes(Object.assign({}, base, { [DocumentApp.Attribute.ITALIC]: true, [DocumentApp.Attribute.FONT_SIZE]: 10, [DocumentApp.Attribute.FOREGROUND_COLOR]: "#8A86A6" }));
  }

  const h = (text) => body.appendParagraph(text).setHeading(DocumentApp.ParagraphHeading.HEADING2)
    .setAttributes(Object.assign({}, base, { [DocumentApp.Attribute.FONT_FAMILY]: "Poppins", [DocumentApp.Attribute.FONT_SIZE]: 15, [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FOREGROUND_COLOR]: "#5A3FD6" }));

  if (polished.length) {
    h("The day");
    polished.forEach((e) => {
      const time = String(e.t || "").trim();
      const p = body.appendParagraph(`${time}   ${String(e.text || "").trim()}`);
      p.setAttributes(base).setSpacingAfter(8);
      if (time) p.editAsText().setBold(0, time.length - 1, true).setForegroundColor(0, time.length - 1, "#B97A12").setFontFamily(0, time.length - 1, "Roboto");
      const media = (e.photos || []).map(mediaItem).filter(Boolean);
      if (media.length) {
        p.setSpacingAfter(4);
        try { appendMedia(body, media, base); }
        catch (err) { console.error("Photos in Doc failed", err); MEDIA_ERRORS.push("Photos couldn't be placed in the Doc: " + String(err && err.message || err).slice(0, 160)); }
      }
    });
  }
  if (String(shukrOut || "").trim()) {
    h("Shukr · الشكر");
    body.appendParagraph(String(shukrOut).trim()).setAttributes(Object.assign({}, base, { [DocumentApp.Attribute.ITALIC]: true }));
  }

  if (usedAI && original.length) {
    body.appendHorizontalRule();
    const note = body.appendParagraph("Your original notes, exactly as typed");
    note.setAttributes(Object.assign({}, base, { [DocumentApp.Attribute.FONT_SIZE]: 9, [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FOREGROUND_COLOR]: "#8A86A6", [DocumentApp.Attribute.FONT_FAMILY]: "Roboto" }));
    original.filter((e) => String(e.text || "").trim()).forEach((e) => body.appendParagraph(`${e.t}  ${e.text}`)
      .setAttributes(Object.assign({}, base, { [DocumentApp.Attribute.FONT_SIZE]: 9, [DocumentApp.Attribute.FOREGROUND_COLOR]: "#8A86A6", [DocumentApp.Attribute.FONT_FAMILY]: "Roboto" })));
    if (String(shukrRaw || "").trim()) body.appendParagraph(`Shukr  ${shukrRaw}`)
      .setAttributes(Object.assign({}, base, { [DocumentApp.Attribute.FONT_SIZE]: 9, [DocumentApp.Attribute.FOREGROUND_COLOR]: "#8A86A6", [DocumentApp.Attribute.FONT_FAMILY]: "Roboto" }));
  }
  doc.saveAndClose();
  return doc.getId();
}

/* ------------------------------------------------------------------ photos */

function photoFolder() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty("PHOTO_FOLDER_ID");
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* recreate */ } }
  const parent = journalFolder();
  const it = parent.getFoldersByName("Photos");
  const f = it.hasNext() ? it.next() : parent.createFolder("Photos");
  p.setProperty("PHOTO_FOLDER_ID", f.getId());
  return f;
}

/** Save one photo from the app. Sending the same photo twice returns the same file. */
function savePhoto(ph) {
  const id = String(ph && ph.id || ""), date = String(ph && ph.date || "");
  if (!/^p[a-z0-9]{4,24}$/.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Bad photo");
  const bytes = Utilities.base64Decode(String(ph.data || ""));
  if (!bytes.length) throw new Error("The photo was empty.");
  if (bytes.length > 12 * 1024 * 1024) throw new Error("Photo too large.");
  const folder = photoFolder();
  const name = `${date} · ${id}.jpg`;
  const same = folder.getFilesByName(name);
  if (same.hasNext()) return { drive: same.next().getId() };
  const file = folder.createFile(Utilities.newBlob(bytes, String(ph.mime || "image/jpeg"), name));
  return { drive: file.getId() };
}

/** Only files inside the Photos or Videos folder can be read or removed through the web link. */
function ownPhoto(driveId) {
  const file = DriveApp.getFileById(String(driveId || ""));
  const ok = [photoFolder().getId(), videoFolder().getId()];
  const parents = file.getParents();
  while (parents.hasNext()) if (ok.indexOf(parents.next().getId()) >= 0) return file;
  throw new Error("Not a Muhasaba photo");
}

function readPhoto(driveId) {
  const blob = ownPhoto(driveId).getBlob();
  return { data: Utilities.base64Encode(blob.getBytes()), mime: blob.getContentType() || "image/jpeg" };
}

function trashPhoto(driveId) {
  try { ownPhoto(driveId).setTrashed(true); } catch (e) { /* already gone */ }
}

/* ------------------------------------------------------------------ videos */

function videoFolder() {
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty("VIDEO_FOLDER_ID");
  if (id) { try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) { /* recreate */ } }
  const parent = journalFolder();
  const it = parent.getFoldersByName("Videos");
  const f = it.hasNext() ? it.next() : parent.createFolder("Videos");
  p.setProperty("VIDEO_FOLDER_ID", f.getId());
  return f;
}

/**
 * One piece of a video upload. Uses Google Drive's resumable upload: the first call opens an upload session,
 * every call after sends the next piece. A call without `data` just asks how far the upload got.
 * Returns { next } (the byte to send next) or { drive } once the file is complete.
 */
function videoPart(v) {
  const id = String(v && v.id || ""), date = String(v && v.date || ""), total = Number(v && v.total);
  const mime = String(v && v.mime || "video/mp4").split(";")[0];
  if (!/^p[a-z0-9]{4,24}$/.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^video\//.test(mime)) throw new Error("Bad video");
  if (!(total > 0) || total > 400 * 1024 * 1024) throw new Error("Video too large (400 MB max).");
  const props = PropertiesService.getScriptProperties();
  const key = "VUP_" + id;
  const name = `${date} · ${id}.${/webm/.test(mime) ? "webm" : /quicktime/.test(mime) ? "mov" : "mp4"}`;
  let session = props.getProperty(key);
  if (!session) {
    const done = videoFolder().getFilesByName(name);
    if (done.hasNext()) return { drive: done.next().getId() };
    const res = UrlFetchApp.fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true", {
      method: "post",
      contentType: "application/json; charset=UTF-8",
      headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken(), "X-Upload-Content-Type": mime, "X-Upload-Content-Length": String(total) },
      payload: JSON.stringify({ name: name, parents: [videoFolder().getId()], mimeType: mime }),
      muteHttpExceptions: true,
    });
    const loc = res.getHeaders().Location || res.getHeaders().location;
    if (res.getResponseCode() >= 300 || !loc) throw new Error("Drive refused the upload (" + res.getResponseCode() + "): " + res.getContentText().slice(0, 160));
    session = loc;
    props.setProperty(key, session);
  }
  const bytes = v.data ? Utilities.base64Decode(String(v.data)) : null;
  const offset = Number(v.offset) || 0;
  const res = UrlFetchApp.fetch(session, {
    method: "put",
    contentType: mime,
    headers: { "Content-Range": bytes && bytes.length ? `bytes ${offset}-${offset + bytes.length - 1}/${total}` : `bytes */${total}` },
    payload: bytes && bytes.length ? bytes : "",
    followRedirects: false, // Drive answers 308 "keep going", which is not a real redirect
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code === 200 || code === 201) {
    props.deleteProperty(key);
    return { drive: JSON.parse(res.getContentText()).id };
  }
  if (code === 308) {
    const range = res.getHeaders().Range || res.getHeaders().range || "";
    const m = /bytes=0-(\d+)/.exec(range);
    return { next: m ? Number(m[1]) + 1 : 0 };
  }
  if (code === 404 || code === 410) { props.deleteProperty(key); return { next: 0, restart: true }; }
  throw new Error("Drive upload error " + code + ": " + res.getContentText().slice(0, 160));
}

/**
 * Run this once from the editor (select testVideoUpload ▸ Exécuter) if videos won't upload.
 * It sends a tiny test video to Drive the same way the app does, asks for any missing permission,
 * and writes the result in the log. The test file is deleted afterwards.
 */
function testVideoUpload() {
  const bytes = Utilities.newBlob("muhasaba video test").getBytes();
  const id = "ptest" + Date.now().toString(36);
  const base = { id: id, date: Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd"), mime: "video/mp4", total: bytes.length };
  let r = videoPart(base);
  console.log("Session opened:", JSON.stringify(r));
  r = videoPart(Object.assign({}, base, { offset: r.next || 0, data: Utilities.base64Encode(bytes) }));
  console.log("Upload result:", JSON.stringify(r));
  if (r.drive) { DriveApp.getFileById(r.drive).setTrashed(true); console.log("✓ Video uploads work. Now publish a new version: Déployer → Gérer les déploiements → ✏️ → Nouvelle version."); }
  return r;
}

/* ------------------------------------------------------------------ media in the Doc */

/** A photo is its Drive id; a video is { v: video id, p: cover id, d: seconds }. */
function mediaItem(x) {
  if (typeof x === "string") return x || null;
  if (x && typeof x === "object" && x.v && x.p) return { v: String(x.v), p: String(x.p), d: Number(x.d) || 0 };
  return null;
}

const PAGE_W = 500; // 8.5in page with 56pt margins
const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Problems met while placing photos in the Doc, reported back to the app. */
const MEDIA_ERRORS = [];

function mediaBlob(m) {
  try { return DriveApp.getFileById(typeof m === "string" ? m : m.p).getBlob(); }
  catch (e) { console.warn("Media missing", m, e); MEDIA_ERRORS.push("A photo couldn't be opened from Drive: " + String(e && e.message || e).slice(0, 120)); return null; }
}

const videoUrl = (m) => `https://drive.google.com/file/d/${m.v}/view`;

/**
 * Lay out an entry's photos and videos like a photo album: pictures in a row share the same height and
 * together fill the page width exactly (so nothing looks stranded in white space).
 *   1 → one large picture · 2 → one row · 3 → one row if they fit nicely, else one large + a row of two
 *   4 → two rows of two.
 * Videos show their cover with a ▶ and link to the video in Drive, with a "Watch" line under the row.
 */
function appendMedia(body, media, base) {
  const items = media.map((m) => ({ m: m, blob: mediaBlob(m) })).filter((x) => x.blob);
  if (!items.length) return;
  const GAP = 6, MAX_H = 360, MIN_ROW_H = 150;

  // Insert each picture once into the first row's paragraph to learn its shape (Docs can't remove a
  // trailing paragraph, so that paragraph is then reused for the first row).
  let spare = body.appendParagraph("");
  const shapes = items.map((it) => {
    const img = spare.appendInlineImage(it.blob);
    const r = img.getWidth() / img.getHeight();
    img.removeFromParent();
    return r;
  });
  const idx = items.map((_, i) => i);
  const fitH = (row) => (PAGE_W - GAP * (row.length - 1)) / row.reduce((a, i) => a + shapes[i], 0);
  let rows;
  if (items.length <= 2) rows = [idx];
  else if (items.length === 3) rows = fitH(idx) >= MIN_ROW_H ? [idx] : [[0], [1, 2]];
  else rows = [[0, 1], [2, 3]];

  rows.forEach((row) => {
    const H = Math.min(MAX_H, fitH(row));
    const par = spare || body.appendParagraph("");
    spare = null;
    par.setAttributes(Object.assign({}, base, { [DocumentApp.Attribute.FONT_SIZE]: 4 }))
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingBefore(0).setSpacingAfter(GAP).setLineSpacing(1);
    row.forEach((i, k) => {
      if (k) par.appendText("  ").setFontSize(4); // the gap between pictures
      const img = par.appendInlineImage(items[i].blob);
      img.setHeight(Math.floor(H)).setWidth(Math.floor(H * shapes[i]));
      if (typeof items[i].m !== "string") img.setLinkUrl(videoUrl(items[i].m));
    });
    const vids = row.map((i) => items[i].m).filter((m) => typeof m !== "string");
    if (vids.length) {
      const cap = body.appendParagraph("");
      vids.forEach((m, k) => {
        const label = `▶  Watch${vids.length > 1 ? " video " + (k + 1) : " the video"}${m.d ? "  ·  " + fmtDur(m.d) : ""}`;
        if (k) cap.appendText("      ");
        cap.appendText(label).setLinkUrl(videoUrl(m));
      });
      cap.setAttributes(Object.assign({}, base, {
        [DocumentApp.Attribute.FONT_FAMILY]: "Roboto", [DocumentApp.Attribute.FONT_SIZE]: 9.5, [DocumentApp.Attribute.BOLD]: true,
        [DocumentApp.Attribute.FOREGROUND_COLOR]: "#5A3FD6",
      })).setAlignment(DocumentApp.HorizontalAlignment.CENTER).setSpacingBefore(0).setSpacingAfter(GAP + 2).setLineSpacing(1);
    }
  });
  body.appendParagraph("").setAttributes(Object.assign({}, base, { [DocumentApp.Attribute.FONT_SIZE]: 4 })).setSpacingBefore(0).setSpacingAfter(10).setLineSpacing(1);
}

/* ================================================================== setup & menu */

/** Run once from the editor (and again after updating the code). Safe to repeat. */
function setup() {
  ensureLog(true);
  storeSheet();
  buildDashboard(true);
  journalFolder();
  photoFolder();
  videoFolder();
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === "processJournals").forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("processJournals").timeBased().everyMinutes(15).create();
  // One hourly heartbeat: nightly reminder email, Insights refresh, Sunday weekly letter.
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === "tick").forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("tick").timeBased().everyHours(1).create();
  buildInsights();
  SpreadsheetApp.getActive().setActiveSheet(SpreadsheetApp.getActive().getSheetByName(DASH));
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Muhasaba")
    .addItem("Set AI key…", "setAiKey")
    .addItem("Polish journals now", "processAllNow")
    .addItem("Polish all journals again", "repolishAllMenu")
    .addItem("Open journal folder", "showFolder")
    .addSeparator()
    .addItem("Refresh Insights now", "buildInsights")
    .addItem("Write this week's letter now", "weeklyLetterMenu")
    .addItem("Send me a test reminder email", "testReminder")
    .addItem("Turn the nightly email on / off", "toggleReminder")
    .addSeparator()
    .addItem("Rebuild formatting & dashboard", "setup")
    .addToUi();
}

function setAiKey() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt("AI key", "Paste a Claude key (sk-ant-…) or a Gemini key (AIza…) for polishing, or an OpenAI key (sk-…) for voice notes. Each kind is kept separately. Leave empty to remove all keys.", ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const k = r.getResponseText().trim();
  const p = PropertiesService.getScriptProperties();
  if (!k) { ["GEMINI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"].forEach((x) => p.deleteProperty(x)); ui.alert("AI keys removed."); return; }
  if (k.startsWith("sk-") && !k.startsWith("sk-ant-")) {
    p.setProperty("OPENAI_API_KEY", k);
    p.deleteProperty("OPENAI_STT_MODEL");
    const res = UrlFetchApp.fetch("https://api.openai.com/v1/models", { headers: { Authorization: "Bearer " + k }, muteHttpExceptions: true });
    ui.alert(res.getResponseCode() === 200
      ? "Voice key works ✓ (OpenAI)\n\nVoice notes in the Journal will now be transcribed."
      : "The key was saved but OpenAI refused it:\n\n" + res.getContentText().slice(0, 300) + "\n\nCheck that billing credit is added on platform.openai.com.");
    return;
  }
  if (k.startsWith("sk-ant-")) { p.setProperty("ANTHROPIC_API_KEY", k); p.deleteProperty("GEMINI_API_KEY"); }
  else { p.setProperty("GEMINI_API_KEY", k); p.deleteProperty("ANTHROPIC_API_KEY"); p.deleteProperty("GEMINI_MODEL_AUTO"); }
  try {
    const test = polishWithAI([{ t: "09:00", text: "alhamdulilah i went to the masjid for subh and memorised my two pages, felt good" }], "", { longDate: "Test" });
    ui.alert(`Key works ✓ (${aiProvider()})\n\nTest rating: ${VERDICT[test.verdict] ? VERDICT[test.verdict].label : test.verdict}\nPolished: ${test.entries[0].text}`);
  } catch (err) {
    ui.alert("The key was saved but the test failed:\n\n" + err.message);
  }
}

function showFolder() {
  const url = journalFolder().getUrl();
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(`<p style="font-family:sans-serif"><a href="${url}" target="_blank">Open “${FOLDER_NAME}” in Drive ↗</a></p>`).setWidth(320).setHeight(80), "Journal folder");
}

function ensureLog(force) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(LOG);
  const fresh = !sh;
  if (!sh) {
    sh = ss.getSheets().length === 1 && ss.getSheets()[0].getLastRow() === 0 ? ss.getSheets()[0].setName(LOG) : ss.insertSheet(LOG);
  }
  const width = Math.min(NCOL, sh.getMaxColumns());
  const headerOk = width === NCOL && sh.getRange(1, 1, 1, NCOL).getValues()[0].join("|") === COLUMNS.map((c) => c[0]).join("|");
  if (!fresh && !force && headerOk) return sh;
  // Columns changed since an older version: move every existing value to its column's new place (matched by
  // header name), so nothing is lost. New columns start empty and fill in as the app re-sends the days.
  if (!fresh && !headerOk) {
    const f = sh.getFilter(); if (f) f.remove();
    const oldW = sh.getLastColumn();
    const last = lastDataRow(sh);
    const oldHead = oldW ? sh.getRange(1, 1, 1, oldW).getValues()[0].map(String) : [];
    let moved = [];
    if (last > 1 && oldW) {
      const rng = sh.getRange(2, 1, last - 1, oldW);
      const vals = rng.getValues(), forms = rng.getFormulas();
      const from = COLUMNS.map(([h]) => oldHead.indexOf(h));
      moved = vals.map((row, r) => from.map((i) => (i < 0 ? "" : forms[r][i] || row[i])));
    }
    sh.getRange(2, 1, sh.getMaxRows() - 1, sh.getMaxColumns()).clearContent().clearDataValidations();
    sh.getRange(1, 1, 1, sh.getMaxColumns()).clearContent();
    if (sh.getMaxColumns() < NCOL) sh.insertColumnsAfter(sh.getMaxColumns(), NCOL - sh.getMaxColumns());
    if (moved.length) sh.getRange(2, 1, moved.length, NCOL).setValues(moved);
  }
  formatLog(sh);
  return sh;
}

function formatLog(sh) {
  if (sh.getMaxColumns() < NCOL) sh.insertColumnsAfter(sh.getMaxColumns(), NCOL - sh.getMaxColumns());
  if (sh.getMaxRows() < MAX_ROWS) sh.insertRowsAfter(sh.getMaxRows(), MAX_ROWS - sh.getMaxRows());

  const head = sh.getRange(1, 1, 1, NCOL);
  head.setValues([COLUMNS.map((c) => c[0])])
    .setFontWeight("bold").setFontColor("#FFFFFF").setBackground(C.night)
    .setVerticalAlignment("middle").setWrap(true);
  sh.setRowHeight(1, 40);
  sh.setFrozenRows(1);
  sh.setFrozenColumns(4);
  COLUMNS.forEach(([, , w], i) => sh.setColumnWidth(i + 1, w));

  // Start from clean cells: after a column move, a column could keep the old column's look (e.g. a date format).
  sh.getRange(2, 1, MAX_ROWS - 1, NCOL).clearFormat();
  const body = (key) => sh.getRange(2, col(key), MAX_ROWS - 1, 1);
  body("date").setNumberFormat("ddd d mmm yyyy");
  body("updated").setNumberFormat("d mmm, HH:mm").setFontColor("#8A86A6");
  ["score", "salah", "quran", "work", "walk"].forEach((k) => body(k).setNumberFormat("0.#").setHorizontalAlignment("center"));
  body("score").setFontWeight("bold");
  body("dayType").setFontWeight("bold").setHorizontalAlignment("center");
  body("journal").setHorizontalAlignment("center");
  body("steps").setNumberFormat("#,##0");
  body("hours").setNumberFormat("0.##");
  ["note", "summary", "topics", "bonusList"].forEach((k) => body(k).setWrap(true));
  body("bonus").setNumberFormat("0.#").setHorizontalAlignment("center").setFontColor("#B97A12").setFontWeight("bold");
  sh.getRange(2, 1, MAX_ROWS - 1, NCOL).setVerticalAlignment("top");

  const prayers = sh.getRange(2, col("subh"), MAX_ROWS - 1, 5);
  sh.getRange(2, 1, MAX_ROWS - 1, NCOL).clearDataValidations();
  prayers.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(PRAYER_LABELS, true).setAllowInvalid(true).build());
  body("difficulty").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(DIFFICULTY, true).setAllowInvalid(true).build());
  body("dayType").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(Object.keys(VERDICT).map((k) => VERDICT[k].label), true).setAllowInvalid(true).build());
  sh.getRange(2, col("preview"), MAX_ROWS - 1, 4).insertCheckboxes();
  sh.getRange(2, col("slip"), MAX_ROWS - 1, 3).insertCheckboxes();
  body("sleepH").setNumberFormat("0.#").setHorizontalAlignment("center");
  ["energy", "mood", "excused", "revised"].forEach((k) => body(k).setHorizontalAlignment("center").setNumberFormat("0"));
  ["energy", "mood"].forEach((k) => body(k).setNumberFormat('0"/5"'));
  ["phone", "reasons", "revRanges"].forEach((k) => body(k).setNumberFormat("@"));
  ["slept", "woke"].forEach((k) => body(k).setNumberFormat("HH:mm").setHorizontalAlignment("center"));
  ["reasons", "revRanges"].forEach((k) => body(k).setWrap(true));

  const rules = [];
  const all = sh.getRange(2, 1, MAX_ROWS - 1, 2);
  const dt = `$${letter("dayType")}2`;
  Object.keys(VERDICT).forEach((k) => {
    const v = VERDICT[k];
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(v.label).setBackground(v.fill).setFontColor(v.ink).setRanges([body("dayType")]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(`=${dt}="${v.label}"`).setBackground(v.fill).setRanges([all]).build());
  });
  rules.push(SpreadsheetApp.newConditionalFormatRule().setGradientMinpointWithValue(C.redSoft, SpreadsheetApp.InterpolationType.NUMBER, "30")
    .setGradientMidpointWithValue(C.amberSoft, SpreadsheetApp.InterpolationType.NUMBER, "70")
    .setGradientMaxpointWithValue("#B6E5CF", SpreadsheetApp.InterpolationType.NUMBER, "100").setRanges([body("score")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Before takbīr").setBackground(C.greenSoft).setFontColor(C.green).setBold(true).setRanges([prayers]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Mosque (late)").setBackground(C.amberSoft).setFontColor("#8A5A00").setRanges([prayers]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("No mosque").setBackground(C.redSoft).setFontColor(C.red).setRanges([prayers]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Excused").setBackground("#E3F0FF").setFontColor("#285A9E").setRanges([prayers]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(6).setFontColor(C.red).setBold(true).setRanges([body("sleepH")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("A lot").setFontColor(C.red).setRanges([body("phone")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("None").setFontColor(C.green).setRanges([body("phone")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(8000).setFontColor(C.green).setBold(true).setRanges([body("steps")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberBetween(1, 7999).setFontColor(C.red).setRanges([body("steps")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThanOrEqualTo(3).setFontColor(C.green).setBold(true).setRanges([body("hours")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenNumberEqualTo(2).setBackground(C.goldSoft).setRanges([body("pages")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Hard").setFontColor(C.red).setRanges([body("difficulty")]).build());
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo("Easy").setFontColor(C.green).setRanges([body("difficulty")]).build());
  sh.setConditionalFormatRules(rules);

  sh.getBandings().forEach((b) => b.remove());
  sh.getRange(1, 1, MAX_ROWS, NCOL).applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY, true, false)
    .setHeaderRowColor(C.night).setFirstRowColor("#FFFFFF").setSecondRowColor(C.band);
  const f = sh.getFilter(); if (f) f.remove();
  sh.getRange(1, 1, MAX_ROWS, NCOL).createFilter();
  sh.setTabColor(C.violet);
}

/* ================================================================== context from the app */

/** Remember the app's time zone, language, name and address, for reminders and letters. */
function rememberContext(rows) {
  const r = (rows || []).filter((x) => x && x.tz)[0];
  if (!r) return;
  const p = PropertiesService.getScriptProperties();
  const cur = p.getProperties();
  const want = { APP_TZ: String(r.tz || ""), APP_LANG: String(r.lang || "en"), APP_NAME: String(r.name || ""), APP_URL: String(r.app || "") };
  Object.keys(want).forEach((k) => { if (want[k] && cur[k] !== want[k]) p.setProperty(k, want[k]); });
}

function appCtx() {
  const p = PropertiesService.getScriptProperties();
  return {
    tz: p.getProperty("APP_TZ") || SpreadsheetApp.getActive().getSpreadsheetTimeZone(),
    fr: p.getProperty("APP_LANG") === "fr",
    name: p.getProperty("APP_NAME") || "",
    url: p.getProperty("APP_URL") || "",
  };
}

/* ================================================================== reading the Log */

const avgOf = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const r1 = (x) => (x == null || isNaN(x) ? "–" : Math.round(x * 10) / 10);
const r0 = (x) => (x == null || isNaN(x) ? "–" : Math.round(x));
const pc = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "–");
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const BAD_DAY = 60;

/** "23:30", a Date (time cell) or a number (fraction of a day) → minutes after midnight. */
function minutesOf(v) {
  if (v instanceof Date) return v.getHours() * 60 + v.getMinutes();
  if (typeof v === "number") return Math.round(v * 1440) % 1440;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(v || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Every logged day as an object keyed like the app's row, oldest first. */
function readDays() {
  const sh = SpreadsheetApp.getActive().getSheetByName(LOG);
  if (!sh) return [];
  const last = lastDataRow(sh);
  if (last < 2) return [];
  const tz = SpreadsheetApp.getActive().getSpreadsheetTimeZone();
  const rng = sh.getRange(2, 1, last - 1, NCOL);
  const vals = rng.getValues(), disp = rng.getDisplayValues();
  const iSlept = col("slept") - 1;
  return vals.map((row, ri) => {
    const o = {};
    COLUMNS.forEach(([, k], i) => (o[k] = row[i]));
    o.slept = disp[ri][iSlept];
    o.key = dateKey(o.date, tz);
    o.d = o.date instanceof Date ? o.date : new Date(o.key);
    o.score = Number(o.score) || 0;
    ["salah", "quran", "work", "walk", "bonus", "pages", "minutes", "hours", "steps", "sleepH", "energy", "mood", "revised", "excused"].forEach((k) => {
      o[k] = o[k] === "" || o[k] == null ? null : Number(o[k]);
    });
    o.bed = minutesOf(o.slept);
    o.ck = o.checkin === true;
    o.slip = o.slip === true;
    o.tawbah = o.tawbah === true;
    return o;
  }).filter((o) => o.key).sort((a, b) => (a.key < b.key ? -1 : 1));
}

function shiftKey(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}

/* ================================================================== Insights tab */

/**
 * Rebuilds the Insights tab: everything worth knowing about your days, computed fresh from the Log.
 * Runs every night (via `tick`) and from the Muhasaba menu.
 */
function buildInsights() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(INSIGHTS);
  if (!sh) sh = ss.insertSheet(INSIGHTS, 1);
  sh.getCharts().forEach((c) => sh.removeChart(c));
  sh.clear();
  sh.clearConditionalFormatRules();
  sh.setHiddenGridlines(true);
  sh.setTabColor(C.green);
  if (sh.getMaxColumns() < 12) sh.insertColumnsAfter(sh.getMaxColumns(), 12 - sh.getMaxColumns());
  [24, 200, 110, 110, 110, 110, 110, 110, 24, 110, 110, 110].forEach((w, i) => sh.setColumnWidth(i + 1, w));

  const days = readDays();
  const ctx = appCtx();
  let row = 2;
  sh.getRange(row, 2, 1, 7).merge().setValue("Insights").setFontSize(26).setFontWeight("bold").setFontColor(C.night);
  row++;
  sh.getRange(row, 2, 1, 7).merge()
    .setValue(`${days.length} days logged · updated ${Utilities.formatDate(new Date(), ctx.tz, "EEE d MMM yyyy, HH:mm")} · refreshes every night`)
    .setFontColor("#6A6688");
  row += 2;

  /** Writes one titled table. `rows` are arrays; `marks` colours given rows: { index: "good" | "bad" }. */
  const block = (title, note, head, rows, marks) => {
    sh.getRange(row, 2, 1, 7).merge().setValue(title).setFontSize(15).setFontWeight("bold").setFontColor(C.night);
    row++;
    if (note) { sh.getRange(row, 2, 1, 7).merge().setValue(note).setFontColor("#6A6688").setFontStyle("italic").setWrap(true); row++; }
    if (!rows || !rows.length) { row++; return; }
    const w = head.length;
    sh.getRange(row, 2, 1, w).setValues([head]).setFontWeight("bold").setFontColor("#FFFFFF").setBackground(C.night);
    const start = row + 1;
    const data = rows.map((r) => head.map((_, i) => (r[i] == null ? "" : r[i])));
    sh.getRange(start, 2, data.length, w).setValues(data).setVerticalAlignment("top");
    data.forEach((_, i) => { if (i % 2) sh.getRange(start + i, 2, 1, w).setBackground(C.band); });
    sh.getRange(start, 2, data.length, 1).setFontWeight("bold");
    Object.keys(marks || {}).forEach((i) => {
      const m = marks[i];
      sh.getRange(start + Number(i), 2, 1, w).setBackground(m === "good" ? C.greenSoft : C.redSoft).setFontColor(m === "good" ? C.green : C.red);
    });
    const range = { start, end: start + data.length - 1, top: row };
    row = start + data.length + 1;
    return range;
  };
  const needs = (title, have, need, what) => block(title, `Needs ${need - have} more ${what} before this means anything (${have}/${need}). Keep logging, it fills in by itself.`, [], []);

  if (!days.length) { block("Nothing to show yet", "Log a few days in the app and this tab fills itself.", [], []); return; }

  const scores = days.map((d) => d.score);
  const byKey = {};
  days.forEach((d) => (byKey[d.key] = d));
  const today = Utilities.formatDate(new Date(), ctx.tz, "yyyy-MM-dd");
  const within = (n) => days.filter((d) => d.key > shiftKey(today, -n) && d.key <= today);

  /* ---- Overview ---- */
  let cur = 0, k = byKey[today] && byKey[today].score >= 70 ? today : shiftKey(today, -1);
  while (byKey[k] && byKey[k].score >= 70) { cur++; k = shiftKey(k, -1); }
  let best = 0, run = 0, prev = null;
  days.forEach((d) => { run = d.score >= 70 ? (prev && shiftKey(prev, 1) === d.key ? run + 1 : 1) : 0; prev = d.score >= 70 ? d.key : null; best = Math.max(best, run); });
  const top = days.reduce((a, b) => (b.score > a.score ? b : a));
  const low = days.reduce((a, b) => (b.score < a.score ? b : a));
  block("Overview", "", ["", "Value", "", "", "", "", ""], [
    ["Days logged", days.length],
    ["Average score", r1(avgOf(scores))],
    ["Last 7 days", r1(avgOf(within(7).map((d) => d.score)))],
    ["Last 30 days", r1(avgOf(within(30).map((d) => d.score)))],
    ["Best day", `${r1(top.score)} · ${Utilities.formatDate(top.d, ctx.tz, "EEE d MMM")}`],
    ["Hardest day", `${r1(low.score)} · ${Utilities.formatDate(low.d, ctx.tz, "EEE d MMM")}`],
    ["Streak at 70+ (now / best)", `${cur} / ${best} days`],
  ]);

  /* ---- Weekdays ---- */
  const wd = [1, 2, 3, 4, 5, 6, 0].map((w) => {
    const xs = days.filter((d) => d.d.getDay() === w);
    const a = (k2) => r1(avgOf(xs.map((d) => d[k2]).filter((v) => v != null)));
    return { w, n: xs.length, avg: avgOf(xs.map((d) => d.score)), row: [WEEKDAYS[w], xs.length, a("score"), a("salah"), a("quran"), a("work"), a("walk")] };
  });
  const wdOk = wd.filter((x) => x.n);
  const wdMarks = {};
  let wdNote = `Early days: weekday patterns firm up after 3–4 weeks (${days.length} days so far).`;
  if (days.length >= 14 && wdOk.length > 1) {
    const hi = wdOk.reduce((a, b) => (b.avg > a.avg ? b : a)), lo = wdOk.reduce((a, b) => (b.avg < a.avg ? b : a));
    if (hi !== lo) {
      wdMarks[wd.indexOf(hi)] = "good"; wdMarks[wd.indexOf(lo)] = "bad";
      wdNote = `Your best day is ${WEEKDAYS[hi.w]} (${r1(hi.avg)}), your hardest is ${WEEKDAYS[lo.w]} (${r1(lo.avg)}).`;
    }
  }
  const wdRange = block("By day of the week", wdNote, ["Day", "Days", "Avg score", "Salah /40", "Qur'an /30", "Work /20", "Walk /10"], wd.map((x) => x.row), wdMarks);
  if (wdRange) {
    sh.insertChart(sh.newChart().asColumnChart()
      .addRange(sh.getRange(wdRange.top, 2, 8, 1)).addRange(sh.getRange(wdRange.top, 4, 8, 1)).setNumHeaders(1)
      .setPosition(wdRange.top, 10, 0, 0).setOption("title", "Average score by weekday").setOption("legend", { position: "none" })
      .setOption("colors", [C.violet]).setOption("vAxis", { viewWindow: { min: 0, max: 100 } })
      .setOption("width", 420).setOption("height", 240).build());
  }

  /* ---- Best & worst days ---- */
  const line = (d) => [Utilities.formatDate(d.d, ctx.tz, "EEE d MMM yyyy"), r1(d.score), d.dayType || "", String(d.summary || "").slice(0, 160)];
  const sorted = days.slice().sort((a, b) => b.score - a.score);
  block("Your 5 best days", "", ["Date", "Score", "Day type", "The day in a line"], sorted.slice(0, 5).map(line));
  block("Your 5 hardest days", "", ["Date", "Score", "Day type", "The day in a line"], sorted.slice(-5).reverse().map(line));

  /* ---- Rebound ---- */
  const nextOf = (pred) => days.filter(pred).map((d) => ({ d, n: byKey[shiftKey(d.key, 1)] })).filter((x) => x.n);
  const reb = (label, list) => {
    const better = list.filter((x) => x.n.score > x.d.score + 5).length, worse = list.filter((x) => x.n.score < x.d.score - 5).length;
    return [label, list.length, r1(avgOf(list.map((x) => x.d.score))), r1(avgOf(list.map((x) => x.n.score))), pc(better, list.length), pc(list.length - better - worse, list.length), pc(worse, list.length)];
  };
  const badNext = nextOf((d) => d.score < BAD_DAY);
  const back2 = days.filter((d) => d.score < BAD_DAY).filter((d) => [1, 2].some((i) => byKey[shiftKey(d.key, i)] && byKey[shiftKey(d.key, i)].score >= 70)).length;
  const badCount = days.filter((d) => d.score < BAD_DAY).length;
  block("How you respond to a bad day", badCount
    ? `After a day under ${BAD_DAY}, you were back at 70+ within two days ${pc(back2, badCount)} of the time.`
    : `No day under ${BAD_DAY} yet. Al-ḥamdu lillāh.`,
    ["After…", "Times", "That day", "Next day", "Better", "Same", "Worse"], [
      reb(`a day under ${BAD_DAY}`, badNext),
      reb("a Hard day (journal)", nextOf((d) => d.dayType === VERDICT.hard.label)),
      reb("a Hard but good day", nextOf((d) => d.dayType === VERDICT.hard_good.label)),
      reb("a Good day", nextOf((d) => d.dayType === VERDICT.good.label)),
      reb("a day at 85+", nextOf((d) => d.score >= 85)),
    ]);

  /* ---- What comes with bad days ---- */
  const ck = days.filter((d) => d.ck);
  if (ck.length < 7) needs("What comes with your bad days", ck.length, 7, "evening check-ins");
  else {
    const bad = ck.filter((d) => d.score < BAD_DAY || d.dayType === VERDICT.hard.label), rest = ck.filter((d) => bad.indexOf(d) < 0);
    const share = (xs, f) => pc(xs.filter(f).length, xs.length);
    const fac = [
      ["Slept under 6 h", (d) => d.sleepH != null && d.sleepH < 6],
      ["Went to sleep after 01:00", (d) => d.bed != null && d.bed >= 60 && d.bed < 12 * 60],
      ["Phone: a lot", (d) => d.phone === "A lot"],
      ["Slipped", (d) => d.slip],
      ["Low energy (1–2)", (d) => d.energy != null && d.energy <= 2],
      ["Low mood (1–2)", (d) => d.mood != null && d.mood <= 2],
      ["Missed Subh in the mosque", (d) => d.subh === "No mosque"],
      ["Under 2,000 steps", (d) => d.steps != null && d.steps < 2000],
    ];
    const rowsF = fac.map(([label, f]) => {
      const a = bad.filter(f).length / (bad.length || 1), b = rest.filter(f).length / (rest.length || 1);
      return { label, a, b, row: [label, share(bad, f), share(rest, f), bad.length ? (a - b >= 0 ? "+" : "") + Math.round((a - b) * 100) + " pts" : "–"] };
    });
    const ranked = rowsF.slice().sort((x, y) => (y.a - y.b) - (x.a - x.b));
    const marks = {};
    if (bad.length >= 3) ranked.slice(0, 2).forEach((x) => { if (x.a - x.b > 0.1) marks[rowsF.indexOf(x)] = "bad"; });
    block("What comes with your bad days", bad.length
      ? `Compared over ${ck.length} checked-in days (${bad.length} bad, ${rest.length} others). The biggest gaps are the likeliest causes, in red.`
      : "No bad days among your checked-in days yet.",
      ["Factor", "On bad days", "On other days", "Gap"], rowsF.map((x) => x.row), marks);
  }

  /* ---- Sleep, phone, energy, mood ---- */
  if (ck.length >= 7) {
    const bucketRows = (groups) => groups.map(([label, f]) => { const xs = ck.filter(f); return [label, xs.length, r1(avgOf(xs.map((d) => d.score))), r1(avgOf(xs.map((d) => d.salah).filter((v) => v != null))), r1(avgOf(xs.map((d) => d.quran).filter((v) => v != null)))]; });
    const hiLo = (rows2) => {
      const ok = rows2.filter((r) => r[1] > 0 && typeof r[2] === "number");
      const m = {};
      if (ok.length > 1) { m[rows2.indexOf(ok.reduce((a, b) => (b[2] > a[2] ? b : a)))] = "good"; m[rows2.indexOf(ok.reduce((a, b) => (b[2] < a[2] ? b : a)))] = "bad"; }
      return m;
    };
    const sleepRows = bucketRows([
      ["Under 6 h", (d) => d.sleepH != null && d.sleepH < 6], ["6–7 h", (d) => d.sleepH >= 6 && d.sleepH < 7],
      ["7–8 h", (d) => d.sleepH >= 7 && d.sleepH < 8], ["8 h or more", (d) => d.sleepH >= 8]]);
    const sleepRange = block("Score by hours of sleep", "", ["Sleep", "Days", "Avg score", "Salah", "Qur'an"], sleepRows, hiLo(sleepRows));
    if (sleepRange) {
      sh.insertChart(sh.newChart().asColumnChart()
        .addRange(sh.getRange(sleepRange.top, 2, 5, 1)).addRange(sh.getRange(sleepRange.top, 4, 5, 1)).setNumHeaders(1)
        .setPosition(sleepRange.top, 10, 0, 0).setOption("title", "Score by sleep").setOption("legend", { position: "none" })
        .setOption("colors", [C.green]).setOption("vAxis", { viewWindow: { min: 0, max: 100 } })
        .setOption("width", 420).setOption("height", 220).build());
    }
    const bedRows = bucketRows([
      ["Before 23:00", (d) => d.bed != null && d.bed >= 12 * 60 && d.bed < 23 * 60], ["23:00–00:00", (d) => d.bed >= 23 * 60],
      ["00:00–01:00", (d) => d.bed != null && d.bed < 60], ["After 01:00", (d) => d.bed != null && d.bed >= 60 && d.bed < 12 * 60]]);
    block("Score by bedtime (the night before)", "", ["Went to sleep", "Days", "Avg score", "Salah", "Qur'an"], bedRows, hiLo(bedRows));
    const phoneRows = bucketRows([["None", (d) => d.phone === "None"], ["A bit", (d) => d.phone === "A bit"], ["A lot", (d) => d.phone === "A lot"]]);
    const nextPhone = (v) => r1(avgOf(ck.filter((d) => d.phone === v).map((d) => byKey[shiftKey(d.key, 1)]).filter(Boolean).map((n) => n.score)));
    block("Score by phone & scrolling", `The day after scrolling a lot you average ${nextPhone("A lot")}; after no scrolling, ${nextPhone("None")}.`,
      ["Phone", "Days", "Avg score", "Salah", "Qur'an"], phoneRows, hiLo(phoneRows));
    const scale = (key2, label) => {
      const rows2 = bucketRows([1, 2, 3, 4, 5].map((n) => [`${label} ${n}/5`, (d) => d[key2] === n]));
      return block(`Score by ${label.toLowerCase()}`, "", [label, "Days", "Avg score", "Salah", "Qur'an"], rows2, hiLo(rows2));
    };
    scale("energy", "Energy");
    scale("mood", "Mood");

    const slips = ck.filter((d) => d.slip), clean = ck.filter((d) => !d.slip);
    const cmp = (label, f, fmt) => [label, fmt(slips.map(f)), fmt(clean.map(f))];
    const share = (xs) => pc(xs.filter(Boolean).length, xs.length);
    const mean = (xs) => r1(avgOf(xs.filter((v) => v != null)));
    block("Days you slipped", slips.length
      ? `${slips.length} of ${ck.length} checked-in days. Tawbah made on ${slips.filter((d) => d.tawbah).length} of them. May Allah accept it.`
      : "None marked. Al-ḥamdu lillāh.",
      ["", "Slipped days", "Other days"], slips.length ? [
        cmp("Average score", (d) => d.score, mean),
        cmp("Sleep (h)", (d) => d.sleepH, mean),
        cmp("Asleep after 01:00", (d) => d.bed != null && d.bed >= 60 && d.bed < 720, share),
        cmp("Phone: a lot", (d) => d.phone === "A lot", share),
        cmp("Energy", (d) => d.energy, mean),
        cmp("Mood", (d) => d.mood, mean),
        cmp("All 5 prayers in the mosque", (d) => PR.every((p) => d[p] === "Before takbīr" || d[p] === "Mosque (late)" || d[p] === "Excused"), share),
      ] : []);
  }

  /* ---- Salah ---- */
  const salahRows = PR.map((p) => {
    const xs = days.filter((d) => d[p]);
    const exc = xs.filter((d) => d[p] === "Excused").length, base = xs.length - exc;
    const reasons = {};
    days.forEach((d) => { const m = new RegExp(PRNAME[p] + ": ([^·✓(]+)").exec(String(d.reasons || "")); if (m) { const r = m[1].trim(); reasons[r] = (reasons[r] || 0) + 1; } });
    const topR = Object.keys(reasons).sort((a, b) => reasons[b] - reasons[a])[0];
    return { p, rate: base ? xs.filter((d) => d[p] === "Before takbīr").length / base : null,
      row: [PRNAME[p], xs.length, pc(xs.filter((d) => d[p] === "Before takbīr").length, base), pc(xs.filter((d) => d[p] === "Before takbīr" || d[p] === "Mosque (late)").length, base), pc(xs.filter((d) => d[p] === "No mosque").length, base), exc, topR ? `${topR} (${reasons[topR]}×)` : ""] };
  });
  const rated = salahRows.filter((x) => x.rate != null);
  const sMarks = {};
  if (rated.length > 1 && days.length >= 7) {
    sMarks[salahRows.indexOf(rated.reduce((a, b) => (b.rate > a.rate ? b : a)))] = "good";
    sMarks[salahRows.indexOf(rated.reduce((a, b) => (b.rate < a.rate ? b : a)))] = "bad";
  }
  block("Salah, prayer by prayer", "Percentages leave out excused prayers.", ["Prayer", "Logged", "Before takbīr", "In the mosque", "No mosque", "Excused", "Top reason when late"], salahRows.map((x) => x.row), sMarks);

  const reasonCount = {};
  days.forEach((d) => String(d.reasons || "").split(" · ").forEach((part) => {
    const m = /^(\w+): ([^✓(]+)/.exec(part.trim());
    if (!m) return;
    const r = m[2].trim();
    reasonCount[r] = reasonCount[r] || { n: 0, at: {} };
    reasonCount[r].n++;
    reasonCount[r].at[m[1]] = (reasonCount[r].at[m[1]] || 0) + 1;
  }));
  const rKeys = Object.keys(reasonCount).sort((a, b) => reasonCount[b].n - reasonCount[a].n);
  block("Why you were late or missed the mosque", rKeys.length ? "" : "Pick a reason on the Salah card when you're late or miss the mosque, and it adds up here.",
    ["Reason", "Times", "Most often at", "Excuse?"], rKeys.map((r) => {
      const at = reasonCount[r].at, top2 = Object.keys(at).sort((a, b) => at[b] - at[a])[0];
      return [r, reasonCount[r].n, `${top2} (${at[top2]}×)`, ["Travelling", "Ill", "Menstruation", "Rain / danger"].indexOf(r) >= 0 ? "Yes" : "No"];
    }));

  /* ---- Qur'an ---- */
  const lastP = days.slice().reverse().find((d) => d.portion);
  const memorised = lastP ? (Number(String(lastP.portion).split(/[–-]/)[0]) - 1 || 0) + (lastP.pages || 0) : 0;
  const pace28 = within(28).reduce((n, d) => n + (d.pages || 0), 0) / 28;
  const finish = pace28 > 0 ? new Date(Date.now() + ((604 - memorised) / pace28) * 864e5) : null;
  const timed = days.filter((d) => d.pages > 0 && d.minutes > 0);
  const mpp = (xs) => r0(avgOf(xs.map((d) => d.minutes / d.pages)));
  const qRows = [
    ["Pages memorised in total", memorised ? `${memorised} / 604 (${Math.round((memorised / 604) * 100)}%)` : "–"],
    ["Memorised since you started logging", days.reduce((n, d) => n + (d.pages || 0), 0) + " pages"],
    ["Pace, last 4 weeks", `${r1(pace28 * 7)} pages a week`],
    ["Finish the Mushaf at this pace", finish ? Utilities.formatDate(finish, ctx.tz, "MMMM yyyy") + ", in shāʾ Allāh" : "–"],
    ["Minutes per page (all)", timed.length ? `${mpp(timed)} min · ${timed.length} timed days` : "Time your ḥifẓ to see this"],
    ["… on Easy days", mpp(timed.filter((d) => d.difficulty === "Easy"))],
    ["… on Normal days", mpp(timed.filter((d) => d.difficulty === "Normal"))],
    ["… on Hard days", mpp(timed.filter((d) => d.difficulty === "Hard"))],
    ["Revised pages, last 7 / 30 days", `${within(7).reduce((n, d) => n + (d.revised || 0), 0)} / ${within(30).reduce((n, d) => n + (d.revised || 0), 0)}`],
    ["Days with murājaʿa (last 30)", pc(within(30).filter((d) => d.revised > 0).length, within(30).length)],
    ["Juz read (days)", days.filter((d) => d.juz === true).length],
    ["Al-Mulk after Subh / Maghrib", `${days.filter((d) => d.mulkSubh === true).length} / ${days.filter((d) => d.mulkMaghrib === true).length} days`],
  ];
  if (timed.length >= 6) {
    const half = Math.floor(timed.length / 2);
    const a = avgOf(timed.slice(0, half).map((d) => d.minutes / d.pages)), b = avgOf(timed.slice(half).map((d) => d.minutes / d.pages));
    qRows.splice(5, 0, ["Getting faster?", b < a ? `Yes: ${r0(a)} → ${r0(b)} min per page` : `Not yet: ${r0(a)} → ${r0(b)} min per page`]);
  }
  block("Qur'an & ḥifẓ", "", ["", "Value"], qRows);
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const end = shiftKey(today, -7 * i), startK = shiftKey(end, -6);
    const xs = days.filter((d) => d.key >= startK && d.key <= end);
    weeks.push([`Week of ${Utilities.formatDate(new Date(startK + "T12:00:00"), ctx.tz, "d MMM")}`, xs.reduce((n, d) => n + (d.pages || 0), 0), xs.reduce((n, d) => n + (d.revised || 0), 0), r1(xs.reduce((n, d) => n + (d.hours || 0), 0)), r0(avgOf(xs.map((d) => d.steps).filter((v) => v != null))), r1(avgOf(xs.map((d) => d.score)))]);
  }
  block("Week by week (last 8 weeks)", "", ["Week", "Pages", "Revised", "Work hours", "Avg steps", "Avg score"], weeks);

  /* ---- Work & walk ---- */
  const topicH = {};
  days.forEach((d) => { const ts = String(d.topics || "").split(",").map((t) => t.trim()).filter(Boolean); ts.forEach((t) => (topicH[t] = (topicH[t] || 0) + (d.hours || 0) / ts.length)); });
  const tk = Object.keys(topicH).sort((a, b) => topicH[b] - topicH[a]);
  const deep = days.filter((d) => d.hours >= 2), little = days.filter((d) => (d.hours || 0) < 1);
  block("MuslimPreneur work", `Days with 2 h+ of work average ${r1(avgOf(deep.map((d) => d.score)))}; days under 1 h average ${r1(avgOf(little.map((d) => d.score)))}.`,
    ["Topic", "Hours (approx.)", "Share"], tk.map((t) => [t, r1(topicH[t]), pc(topicH[t], tk.reduce((n, x) => n + topicH[x], 0))]));
  const walked = days.filter((d) => d.steps != null);
  const goal = walked.filter((d) => d.steps >= 8000);
  block("Walking", "", ["", "Value"], [
    ["Average steps", r0(avgOf(walked.map((d) => d.steps)))],
    ["Days at 8,000+", `${goal.length} (${pc(goal.length, walked.length)})`],
    ["Avg score on 8k days / other days", `${r1(avgOf(goal.map((d) => d.score)))} / ${r1(avgOf(walked.filter((d) => d.steps < 8000).map((d) => d.score)))}`],
    ["Best walk", walked.length ? `${walked.reduce((a, b) => (b.steps > a.steps ? b : a)).steps.toLocaleString()} steps` : "–"],
  ]);

  /* ---- Months ---- */
  const months = {};
  days.forEach((d) => { const m = d.key.slice(0, 7); (months[m] = months[m] || []).push(d); });
  block("Month by month", "", ["Month", "Days", "Avg score", "Salah", "Qur'an", "Work", "Walk"], Object.keys(months).sort().reverse().map((m) => {
    const xs = months[m], a = (k2) => r1(avgOf(xs.map((d) => d[k2]).filter((v) => v != null)));
    return [Utilities.formatDate(new Date(m + "-15T12:00:00"), ctx.tz, "MMMM yyyy"), xs.length, a("score"), a("salah"), a("quran"), a("work"), a("walk")];
  }));

  /* ---- Day types & bonus ---- */
  block("How your days felt (journal)", "", ["Day type", "Days", "Avg score", "Avg sleep (h)", "Phone a lot"], Object.keys(VERDICT).map((v) => {
    const xs = days.filter((d) => d.dayType === VERDICT[v].label);
    return [VERDICT[v].label, xs.length, r1(avgOf(xs.map((d) => d.score))), r1(avgOf(xs.map((d) => d.sleepH).filter((x) => x != null))), pc(xs.filter((d) => d.phone === "A lot").length, xs.filter((d) => d.phone).length)];
  }));
  const has = (w) => days.filter((d) => String(d.bonusList || "").indexOf(w) >= 0).length;
  block("Voluntary deeds ✦", "", ["", "Days"], [
    ["Tahajjud", has("Tahajjud")], ["Witr", has("Witr")], ["Ḍuḥā", has("Ḍuḥā")], ["Voluntary fasts", has("Voluntary fast")],
    ["Morning / evening adhkār", `${has("Morning adhkār")} / ${has("Evening adhkār")}`], ["All 12 rawātib", has("Rawātib 12/12")],
    ["Average bonus per day", r1(avgOf(days.map((d) => d.bonus || 0)))],
  ]);

  /* ---- Weekly letters ---- */
  const letters = JSON.parse(PropertiesService.getScriptProperties().getProperty("LETTERS") || "[]");
  block("Weekly letters", letters.length ? "Written every Sunday evening from your week." : "Your first letter arrives on Sunday evening. Or: Muhasaba menu → Write this week's letter now.",
    ["Week", "Letter"], letters.map((l) => [l.week, `=HYPERLINK("${l.url}","${String(l.title || "Open").replace(/"/g, "'")} ↗")`]));
}

const PR = ["subh", "dhuhr", "asr", "maghrib", "isha"];
const PRNAME = { subh: "Subh", dhuhr: "Dhuhr", asr: "Asr", maghrib: "Maghrib", isha: "Isha" };

/* ================================================================== hourly heartbeat */

/** Runs every hour: the 22:00 reminder, the night-time Insights refresh, and the Sunday letter. */
function tick() {
  const ctx = appCtx();
  const p = PropertiesService.getScriptProperties();
  const now = new Date();
  const hour = Number(Utilities.formatDate(now, ctx.tz, "H"));
  const dayK = Utilities.formatDate(now, ctx.tz, "yyyy-MM-dd");
  const dow = Utilities.formatDate(now, ctx.tz, "u"); // 7 = Sunday
  if (hour >= REMIND_HOUR && p.getProperty("REMINDED") !== dayK && p.getProperty("REMIND_OFF") !== "1") {
    p.setProperty("REMINDED", dayK);
    try { sendReminder(dayK, false); } catch (err) { console.error("Reminder failed", err); }
  }
  if (hour >= 3 && p.getProperty("INSIGHTS_DAY") !== dayK) {
    p.setProperty("INSIGHTS_DAY", dayK);
    try { buildInsights(); } catch (err) { console.error("Insights failed", err); }
  }
  if (dow === "7" && hour >= LETTER_HOUR && p.getProperty("LETTER_DAY") !== dayK) {
    p.setProperty("LETTER_DAY", dayK);
    try { weeklyLetter(dayK); } catch (err) { console.error("Weekly letter failed", err); }
  }
}

/* ================================================================== nightly reminder email */

/** Emails you what's still missing today. Sends nothing when the day is complete (unless `always`). */
function sendReminder(dayK, always) {
  const ctx = appCtx();
  const T = (en, fr) => (ctx.fr ? fr : en);
  const d = readDays().find((x) => x.key === dayK);
  const missing = [];
  if (!d) missing.push(T("Nothing logged today yet.", "Rien n'est encore noté aujourd'hui."));
  else {
    const left = PR.filter((p) => !d[p]).map((p) => PRNAME[p]);
    if (left.length) missing.push(T("Prayers not logged: ", "Prières non notées : ") + left.join(", "));
    if (!d.ck) missing.push(T("The evening check-in (sleep, phone, energy, mood).", "Le bilan du soir (sommeil, téléphone, énergie, humeur)."));
    if (!d.pages) missing.push(T("Today's ḥifẓ pages.", "Les pages de ḥifẓ du jour."));
    const store = storeSheet(), r = storeFind(store, dayK);
    const entries = r ? JSON.parse(storeRead(store, r).entries || "[]") : [];
    if (!entries.length) missing.push(T("No journal entry yet: one line about your day is enough.", "Aucune note dans le journal : une ligne sur la journée suffit."));
  }
  if (!missing.length && !always) return false;
  const to = Session.getEffectiveUser().getEmail();
  const hi = ctx.name ? T(`As-salāmu ʿalaykum ${ctx.name},`, `As-salāmu ʿalaykum ${ctx.name},`) : "As-salāmu ʿalaykum,";
  const score = d ? T(`Today so far: ${r1(d.score)}/100.`, `Aujourd'hui pour l'instant : ${r1(d.score)}/100.`) : "";
  const list = missing.length ? missing : [T("Everything is logged. Mā shāʾ Allāh.", "Tout est noté. Mā shāʾ Allāh.")];
  const btn = ctx.url ? `<p><a href="${ctx.url}" style="display:inline-block;background:#5A3FD6;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:bold">${T("Open Muhasaba", "Ouvrir Muhasaba")}</a></p>` : "";
  MailApp.sendEmail({
    to: to,
    name: "Muhasaba",
    subject: missing.length ? T(`Muhasaba · ${missing.length} thing${missing.length > 1 ? "s" : ""} left for today`, `Muhasaba · encore ${missing.length} chose${missing.length > 1 ? "s" : ""} pour aujourd'hui`) : "Muhasaba",
    htmlBody: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1B1F4B;line-height:1.5">
      <p>${hi}</p><p>${score}</p><ul>${list.map((x) => `<li>${x}</li>`).join("")}</ul>${btn}
      <p style="color:#8A86A6;font-size:12px">${T("Sent at 22:00 when something is missing. Turn it off from the Muhasaba menu in your sheet.", "Envoyé à 22h quand il manque quelque chose. Désactivable depuis le menu Muhasaba de la feuille.")}</p></div>`,
  });
  return true;
}

function testReminder() {
  const ctx = appCtx();
  sendReminder(Utilities.formatDate(new Date(), ctx.tz, "yyyy-MM-dd"), true);
  SpreadsheetApp.getActive().toast("Test email sent to " + Session.getEffectiveUser().getEmail(), "Muhasaba");
}

function toggleReminder() {
  const p = PropertiesService.getScriptProperties();
  const off = p.getProperty("REMIND_OFF") === "1";
  if (off) p.deleteProperty("REMIND_OFF"); else p.setProperty("REMIND_OFF", "1");
  SpreadsheetApp.getActive().toast(off ? "Nightly email is ON (22:00 when something is missing)." : "Nightly email is OFF.", "Muhasaba");
}

/* ================================================================== weekly letter */

function weeklyLetterMenu() {
  const ctx = appCtx();
  const url = weeklyLetter(Utilities.formatDate(new Date(), ctx.tz, "yyyy-MM-dd"));
  SpreadsheetApp.getActive().toast(url ? "This week's letter is in your Drive and your inbox." : "Not enough logged this week for a letter.", "Muhasaba");
}

/**
 * Every Sunday evening: the AI reads the last 7 days (scores, journals, check-ins, reasons) and writes you a short
 * letter: what went well, what was hard, one pattern, one focus for next week. Saved as a Doc and emailed.
 */
function weeklyLetter(endK) {
  const ctx = appCtx();
  const startK = shiftKey(endK, -6);
  const days = readDays().filter((d) => d.key >= startK && d.key <= endK);
  if (days.length < 3) return null;
  const store = storeSheet();
  const facts = days.map((d) => {
    const r = storeFind(store, d.key);
    const o = r ? storeRead(store, r) : {};
    return {
      date: Utilities.formatDate(d.d, ctx.tz, "EEE d MMM"), score: d.score, salah: d.salah, quran: d.quran, work: d.work, walk: d.walk,
      prayers: PR.map((p) => `${PRNAME[p]}: ${d[p] || "–"}`).join(", "), why: d.reasons || "", pages: d.pages, revised: d.revised,
      hours: d.hours, topics: d.topics, steps: d.steps, sleep: d.sleepH, phone: d.phone, energy: d.energy, mood: d.mood,
      slipped: d.slip, tawbah: d.tawbah, bonus: d.bonusList, dayType: d.dayType, journal: [o.title, o.summary].filter(Boolean).join(". "),
    };
  });
  const prev = readDays().filter((d) => d.key >= shiftKey(startK, -7) && d.key < startK);
  const prompt = [
    `You write a short weekly letter to ${ctx.name || "a young Muslim"} who tracks his days in an app called Muhasaba: salah (40 pts), Qur'an memorisation (30), work on his business MuslimPreneur (20) and walking (10), plus an evening check-in (sleep, phone use, energy, mood, a private "slipped" mark and whether he made tawbah).`,
    `Write in ${ctx.fr ? "French" : "English"}, warm and honest like a wise older brother, never preachy or flattering. Use only the facts given. Mention a slip only gently and only if tawbah context helps; never ask about details.`,
    `Previous week's average score: ${prev.length ? Math.round(avgOf(prev.map((d) => d.score))) : "unknown"}.`,
    "This week (JSON):",
    JSON.stringify(facts),
    'Reply with JSON only: {"title":"max 7 words","opening":"2 sentences","wins":["3 short specific points"],"hard":["1-3 short specific points"],"pattern":"one pattern you notice, citing numbers","focus":"one concrete focus for next week","dua":"a short duʿāʾ"}',
  ].join("\n");
  let L = null;
  try { L = parseJson(callAI(prompt, 3000)); } catch (err) { console.error("Letter AI failed", err); }
  const avgW = Math.round(avgOf(days.map((d) => d.score)));
  if (!L) L = { title: `Your week: ${avgW}/100`, opening: "No AI key, so here are your numbers.", wins: [], hard: [], pattern: "", focus: "", dua: "" };

  const week = `${Utilities.formatDate(days[0].d, ctx.tz, "d MMM")} – ${Utilities.formatDate(days[days.length - 1].d, ctx.tz, "d MMM yyyy")}`;
  const folder = (() => { const parent = journalFolder(); const it = parent.getFoldersByName("Weekly letters"); return it.hasNext() ? it.next() : parent.createFolder("Weekly letters"); })();
  const doc = DocumentApp.create(`Muhasaba · Week of ${week}`);
  DriveApp.getFileById(doc.getId()).moveTo(folder);
  const body = doc.getBody();
  body.setMarginLeft(56).setMarginRight(56);
  const A = DocumentApp.Attribute;
  const style = (o) => { const x = {}; Object.keys(o).forEach((k) => (x[A[k]] = o[k])); return x; };
  const H = (t, lvl) => { const h = body.appendParagraph(t); h.setHeading(lvl); h.setAttributes(style({ FOREGROUND_COLOR: C.night, FONT_FAMILY: "Roboto", BOLD: true })); return h; };
  const P = (t) => { const x = body.appendParagraph(t); x.setAttributes(style({ FONT_FAMILY: "Lora", FONT_SIZE: 11.5, FOREGROUND_COLOR: "#2A2840" })); x.setLineSpacing(1.35); x.setSpacingAfter(8); return x; };
  const LI = (t) => { const li = body.appendListItem(t); li.setGlyphType(DocumentApp.GlyphType.BULLET); li.setAttributes(style({ FONT_FAMILY: "Lora", FONT_SIZE: 11.5 })); li.setSpacingAfter(4); return li; };
  const first = body.getParagraphs()[0];
  first.setText(L.title || "Your week");
  first.setHeading(DocumentApp.ParagraphHeading.TITLE);
  first.setAttributes(style({ FOREGROUND_COLOR: C.night, FONT_FAMILY: "Roboto", BOLD: true }));
  const sub = body.appendParagraph(`${week} · ${ctx.fr ? "moyenne" : "average"} ${avgW}/100 · ${days.length} ${ctx.fr ? "jours" : "days"}`);
  sub.setAttributes(style({ FOREGROUND_COLOR: "#8A86A6", FONT_SIZE: 10, FONT_FAMILY: "Roboto" }));
  P(L.opening || "");
  if ((L.wins || []).length) { H(ctx.fr ? "Ce qui a bien marché" : "What went well", DocumentApp.ParagraphHeading.HEADING2); L.wins.forEach(LI); }
  if ((L.hard || []).length) { H(ctx.fr ? "Ce qui a été dur" : "What was hard", DocumentApp.ParagraphHeading.HEADING2); L.hard.forEach(LI); }
  if (L.pattern) { H(ctx.fr ? "Ce que je remarque" : "A pattern", DocumentApp.ParagraphHeading.HEADING2); P(L.pattern); }
  if (L.focus) { H(ctx.fr ? "Une seule chose pour la semaine prochaine" : "One focus for next week", DocumentApp.ParagraphHeading.HEADING2); P(L.focus); }
  H(ctx.fr ? "Les chiffres" : "The numbers", DocumentApp.ParagraphHeading.HEADING2);
  const t = body.appendTable([["", ctx.fr ? "Score" : "Score", "Salah", "Qur'an", ctx.fr ? "Travail" : "Work", ctx.fr ? "Marche" : "Walk", ctx.fr ? "Sommeil" : "Sleep"]].concat(
    days.map((d) => [Utilities.formatDate(d.d, ctx.tz, "EEE d"), String(r1(d.score)), String(r1(d.salah)), String(r1(d.quran)), String(r1(d.work)), String(r1(d.walk)), d.sleepH != null ? d.sleepH + " h" : "–"])));
  t.setBorderColor("#E4E1F0");
  t.setAttributes(style({ FONT_SIZE: 10, FONT_FAMILY: "Roboto" }));
  const hr = t.getRow(0); for (let i = 0; i < hr.getNumCells(); i++) hr.getCell(i).setBackgroundColor(C.night).editAsText().setForegroundColor("#FFFFFF").setBold(true);
  if (L.dua) {
    body.appendParagraph("");
    const du = body.appendParagraph(L.dua);
    du.setAttributes(style({ ITALIC: true, FOREGROUND_COLOR: C.violet, FONT_FAMILY: "Lora", FONT_SIZE: 12 }));
    du.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  }
  doc.saveAndClose();
  const url = doc.getUrl();

  const p = PropertiesService.getScriptProperties();
  const letters = JSON.parse(p.getProperty("LETTERS") || "[]");
  letters.unshift({ week: week, url: url, title: L.title || "" });
  p.setProperty("LETTERS", JSON.stringify(letters.slice(0, 26)));
  try {
    MailApp.sendEmail({ to: Session.getEffectiveUser().getEmail(), name: "Muhasaba", subject: `Muhasaba · ${L.title || (ctx.fr ? "Ta semaine" : "Your week")}`,
      htmlBody: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1B1F4B;line-height:1.5"><p>${L.opening || ""}</p>${L.focus ? `<p><b>${ctx.fr ? "Pour la semaine prochaine" : "Next week"}:</b> ${L.focus}</p>` : ""}<p><a href="${url}" style="display:inline-block;background:#5A3FD6;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:bold">${ctx.fr ? "Lire la lettre" : "Read the letter"}</a></p></div>` });
  } catch (err) { console.error("Letter email failed", err); }
  try { buildInsights(); } catch (err) { console.error(err); }
  return url;
}

/* ================================================================== dashboard */

function buildDashboard(force) {
  const ss = SpreadsheetApp.getActive();
  let d = ss.getSheetByName(DASH);
  if (d && !force) return d;
  if (d) {
    d.getCharts().forEach((c) => d.removeChart(c));
    d.clear();
    d.clearConditionalFormatRules();
  } else {
    d = ss.insertSheet(DASH, 0);
  }
  d.setTabColor(C.gold);
  d.setHiddenGridlines(true);
  [24, 190, 120, 24, 190, 120, 24, 190, 120, 24, 160, 80, 80].forEach((w, i) => d.setColumnWidth(i + 1, w));

  const L = (k) => `${LOG}!${letter(k)}2:${letter(k)}`;
  const prayers = `${LOG}!${letter("subh")}2:${letter("isha")}`;

  d.getRange("B2:H2").merge().setValue("Muhasaba").setFontSize(26).setFontWeight("bold").setFontColor(C.night);
  d.getRange("B3:H3").merge().setFormula(F(`="Mohamed Diallo · "&COUNT(${L("date")})&" days logged · updated "&IFERROR(TEXT(MAX(${L("updated")}),"d mmm, HH:mm"),"–")`))
    .setFontColor("#6A6688");

  const tiles = [
    ["Last 7 days average", `=IFERROR(ROUND(AVERAGEIFS(${L("score")},${L("date")},">="&(TODAY()-6)),0),"–")`, "0", C.goldSoft],
    ["All-time average", `=IFERROR(ROUND(AVERAGE(${L("score")}),0),"–")`, "0", C.violetSoft],
    ["Best day", `=IFERROR(MAX(${L("score")}),"–")`, "0", C.violetSoft],
    ["🟢 Good days", `=COUNTIF(${L("dayType")},"${VERDICT.good.label}")`, "0", VERDICT.good.fill],
    ["🟡 Hard but good", `=COUNTIF(${L("dayType")},"${VERDICT.hard_good.label}")`, "0", VERDICT.hard_good.fill],
    ["🔴 Hard days", `=COUNTIF(${L("dayType")},"${VERDICT.hard.label}")`, "0", VERDICT.hard.fill],
    ["Prayers in the mosque", `=IFERROR((COUNTIF(${prayers},"Before takbīr")+COUNTIF(${prayers},"Mosque (late)"))/(COUNTA(${prayers})-COUNTIF(${prayers},"Excused")),"–")`, "0%", C.violetSoft],
    ["Before the takbīr", `=COUNTIF(${prayers},"Before takbīr")`, "0", C.violetSoft],
    ["Pages memorised", `=SUM(${L("pages")})`, "0", C.violetSoft],
    ["MuslimPreneur hours", `=SUM(${L("hours")})`, "0.#", C.violetSoft],
    ["Days at 8k+ steps", `=COUNTIF(${L("steps")},">=8000")`, "0", C.violetSoft],
    ["✦ Bonus points", `=SUM(${L("bonus")})`, "0.#", C.goldSoft],
  ];
  tiles.forEach(([label, f, fmt, bg], i) => {
    const r = 5 + Math.floor(i / 3) * 3, c = 2 + (i % 3) * 3;
    d.getRange(r, c, 1, 2).merge().setValue(label).setFontColor("#6A6688").setFontSize(10).setFontWeight("bold");
    d.getRange(r + 1, c, 1, 2).merge().setFormula(F(f)).setNumberFormat(fmt).setFontSize(24).setFontWeight("bold").setFontColor(C.night).setHorizontalAlignment("left");
    d.getRange(r, c, 2, 2).setBackground(bg);
  });
  for (let r = 5; r <= 16; r++) d.setRowHeight(r, r % 3 === 0 ? 40 : 22);

  // Day-type table (feeds the pie chart).
  d.getRange("K5:M5").setValues([["Day type", "Days", "Avg score"]]).setFontWeight("bold").setFontColor("#FFFFFF").setBackground(C.night);
  Object.keys(VERDICT).forEach((k, i) => {
    const v = VERDICT[k], r = 6 + i;
    d.getRange(r, 11).setValue(v.label).setBackground(v.fill).setFontColor(v.ink).setFontWeight("bold");
    d.getRange(r, 12).setFormula(F(`=COUNTIF(${L("dayType")},K${r})`));
    d.getRange(r, 13).setFormula(F(`=IFERROR(ROUND(AVERAGEIF(${L("dayType")},K${r},${L("score")}),0),"–")`));
  });

  d.getRange("B18").setValue("Score, every day").setFontWeight("bold").setFontColor(C.night);
  // Sparkline options live in cells (Z1:AA4) so the formula has no array literal, which differs between locales.
  d.getRange("Z1:AA4").setValues([["charttype", "column"], ["ymin", 0], ["ymax", 100], ["color", C.violet]]).setFontColor("#FFFFFF");
  d.getRange("B19:H19").merge().setFormula(F(`=SPARKLINE(FILTER(${L("score")},${L("date")}<>""),Z1:AA4)`));
  d.setRowHeight(19, 60);

  const log = ss.getSheetByName(LOG) || ensureLog();
  const rng = (k) => log.getRange(`${letter(k)}1:${letter(k)}${MAX_ROWS}`);

  d.insertChart(d.newChart().asPieChart()
    .addRange(d.getRange("K5:L8")).setNumHeaders(1)
    .setPosition(10, 11, 0, 0)
    .setOption("title", "How your days felt").setOption("pieHole", 0.45)
    .setOption("colors", ["#3FBF86", "#F2B84B", "#E0664A"])
    .setOption("width", 360).setOption("height", 260).build());

  d.insertChart(d.newChart().setChartType(Charts.ChartType.LINE)
    .addRange(rng("date")).addRange(rng("score")).setNumHeaders(1)
    .setPosition(21, 2, 0, 0)
    .setOption("title", "Daily score").setOption("legend", { position: "none" })
    .setOption("colors", [C.violet]).setOption("lineWidth", 3).setOption("pointSize", 5)
    .setOption("vAxis", { viewWindow: { min: 0, max: 100 }, gridlines: { count: 5 } })
    .setOption("width", 720).setOption("height", 300).build());

  d.insertChart(d.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(rng("date")).addRange(log.getRange(`${letter("salah")}1:${letter("walk")}${MAX_ROWS}`)).setNumHeaders(1)
    .setOption("isStacked", true).setPosition(37, 2, 0, 0)
    .setOption("title", "Where the points came from").setOption("legend", { position: "top" })
    .setOption("colors", [C.violet, C.gold, C.green, "#8F94B8"])
    .setOption("vAxis", { viewWindow: { min: 0, max: 100 } })
    .setOption("width", 720).setOption("height", 320).build());

  d.insertChart(d.newChart().setChartType(Charts.ChartType.COLUMN)
    .addRange(rng("date")).addRange(rng("steps")).setNumHeaders(1)
    .setPosition(54, 2, 0, 0)
    .setOption("title", "Steps (goal 8,000)").setOption("legend", { position: "none" }).setOption("colors", [C.green])
    .setOption("width", 720).setOption("height", 260).build());

  d.getRange("B69").setValue("This sheet fills itself from the Muhasaba app. Edits made here are overwritten the next time you change that day in the app. Day type comes from your journal.")
    .setFontColor("#8A86A6").setFontStyle("italic");
  return d;
}
