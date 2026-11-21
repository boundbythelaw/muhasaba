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
  ["Rules", "rules", 52],
  ["Salah /40", "salah", 76],
  ["Qur'an /30", "quran", 80],
  ["Productive /20", "work", 84],
  ["Walk /10", "walk", 70],
  ["Subh", "subh", 112],
  ["Dhuhr", "dhuhr", 112],
  ["Asr", "asr", 112],
  ["Maghrib", "maghrib", 112],
  ["Isha", "isha", 112],
  ["Why late / missed", "reasons", 220],
  ["Khushūʿ %", "khushu", 70],
  ["Khushūʿ notes", "khushuNote", 260],
  ["Excused", "excused", 66],
  ["Pages memorised", "pages", 84],
  ["Portion", "portion", 82],
  ["Minutes", "minutes", 70],
  ["Difficulty", "difficulty", 84],
  ["Music day before", "music", 90],
  ["Preview", "preview", 66],
  ["1 juz", "juz", 56],
  ["Mulk (Subh)", "mulkSubh", 84],
  ["Mulk (Maghrib)", "mulkMaghrib", 100],
  ["Revised pages", "revised", 70],
  ["Revision", "revRanges", 120],
  ["Tathbīt", "tathbit", 130],
  ["Hours", "hours", 60],
  ["Topics", "topics", 200],
  ["What was productive", "note", 280],
  ["Steps", "steps", 76],
  ["Workout", "workout", 150],
  ["Slept", "slept", 62],
  ["Woke", "woke", 62],
  ["Sleep (h)", "sleepH", 66],
  ["Phone", "phone", 70],
  ["Energy", "energy", 62],
  ["Mood", "mood", 58],
  ["Slipped", "slip", 66],
  ["Tawbah", "tawbah", 66],
  ["Check-in ✓", "checkin", 76],
  ["Self-control", "sc", 150],
  ["Bonus ✦", "bonus", 70],
  ["Bonus deeds", "bonusList", 220],
  ["Ṣalawāt", "salawat", 70],
  ["Tasbīḥ", "tasbih", 70],
  ["Journal", "journal", 96],
  ["The day in a line", "summary", 300],
  ["Last update", "updated", 140],
];
/** Bumped whenever COLUMNS change. The app re-sends every day when it sees a new number. */
const SCHEMA = 5;

/**
 * Major updates, newest first (same list as the app's "What's new"). Written to the Updates tab so you can
 * see when the scoring changed and why. Days keep the rules they were logged with (the "Rules" column).
 */
const UPDATES = [
  { v: 2, date: "2026-11-18", title: "Khushūʿ, tathbīt, workout and self-control",
    changes: ["Salah: one prayer at a time, with a step-by-step popup (when you joined, why, khushūʿ)", "Khushūʿ after each prayer", "Late: how many rakʿahs you missed", "New reasons: Call of nature, Ill / stomach ache", "Qurʾān: tathbīt (10× memorised + 10× read, one page a day)", "Health: walk + home workout", "Self-control: private streak, urge help, milestones to Ramadan", "Calmer screen: every card folds"],
    scoring: ["Late: right after the takbīr 6 · missed less than half 4 · exactly half 2 · more than half 0", "Call of nature: late 6 · at home 4", "Health 10 = steps 5 + workout 5 (before: steps 10)", "Tathbīt = ✦ bonus up to +5; khushūʿ and self-control not scored", "Days before 18 Nov 2026 keep their old scores (Rules = 1)"] },
  { v: 1, date: "2026-11-05", title: "First version",
    changes: ["Salah 40 · Qurʾān 30 · Work/Productivity 20 · Walk 10"],
    scoring: ["Late to the mosque = 4, before the takbīr = 8", "Walk: 8,000 steps = 10"] },
];

function buildUpdates() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName("Updates") || ss.insertSheet("Updates");
  sh.clear();
  sh.setHiddenGridlines(true);
  sh.getRange(1, 1, 1, 5).setValues([["Version", "From", "What changed", "Scoring changes", "Title"]]).setFontWeight("bold").setFontColor("#FFFFFF").setBackground(C.night);
  const rows = UPDATES.map((u) => [`v${u.v}`, u.date, u.changes.map((x) => "• " + x).join("\n"), u.scoring.map((x) => "• " + x).join("\n"), u.title]);
  sh.getRange(2, 1, rows.length, 5).setValues(rows).setVerticalAlignment("top").setWrap(true);
  [70, 100, 420, 420, 260].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.setFrozenRows(1);
}
/** Old header names, so a renamed column keeps its data when the Log is migrated. */
const HEADER_ALIASES = { "Productive /20": ["Work /20"], "Hours": [], "Topics": [], "What was productive": ["What moved forward"] };
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
  if (body.photo || body.photoGet || body.photoDelete || body.video || body.mediaFind) {
    try {
      if (body.mediaFind) return json(Object.assign({ ok: true }, findMedia(body.mediaFind)));
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
    if (body.future || body.futureCancel || body.futureList) {
      return json(Object.assign({ ok: true }, futureApi(body)));
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
    const date = String(r[S("date") - 1]), docId = r[S("docId") - 1], tabId = r[S("tabId") - 1];
    if (!docId) return;
    const verdict = r[S("verdict") - 1], title = r[S("title") - 1], summary = r[S("summary") - 1];
    out[date] = {
      dayType: verdict && VERDICT[verdict] ? VERDICT[verdict].label : "",
      journal: F(`=HYPERLINK("${docUrl(docId, tabId)}","Open ↗")`),
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

const SCOLS = ["date", "entries", "shukr", "meta", "hash", "processedHash", "docId", "changedAt", "verdict", "title", "summary", "error", "tabId"];
/** Link to a day: its tab in the month Doc, or (older days) its own Doc. */
const docUrl = (docId, tabId) => (docId ? `https://docs.google.com/document/d/${docId}/edit${tabId ? "?tab=" + tabId : ""}` : "");
const S = (k) => SCOLS.indexOf(k) + 1;

function storeSheet() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(STORE);
  if (!sh) {
    sh = ss.insertSheet(STORE);
    sh.getRange(1, 1, 1, SCOLS.length).setValues([SCOLS]).setFontWeight("bold");
    sh.hideSheet();
  }
  if (sh.getMaxColumns() < SCOLS.length) sh.insertColumnsAfter(sh.getMaxColumns(), SCOLS.length - sh.getMaxColumns());
  if (sh.getRange(1, SCOLS.length).getValue() !== SCOLS[SCOLS.length - 1]) sh.getRange(1, 1, 1, SCOLS.length).setValues([SCOLS]).setFontWeight("bold");
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
      url: docUrl(o.docId, o.tabId),
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
  const out = writeDoc(o.docId, o.tabId, date, meta, entries, polished, shukr, shukrOut, verdict, title, summary, !!ai);
  const docId = out.docId;
  const problems = [aiError && "AI polish failed: " + aiError.slice(0, 200)].concat(MEDIA_ERRORS.slice(0, 2)).filter(Boolean).join(" · ");
  if (!keepOld) sh.getRange(r, S("processedHash")).setValue(o.hash); // a failed AI call stays pending, so it retries
  sh.getRange(r, S("docId")).setValue(docId);
  sh.getRange(r, S("tabId")).setValue(out.tabId || "");
  sh.getRange(r, S("verdict"), 1, 4).setValues([[verdict, title, summary, problems]]);
  setManaged(date, verdict, docUrl(docId, out.tabId), title ? `${title}. ${summary}` : summary);
  if (out.tabId) { try { refreshCover(date.slice(0, 7)); } catch (err) { console.warn("Cover", err); } }
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
    "You edit the private daily journal of Mohamed Diallo, 20, a young Muslim who is memorising the Qur'an, building his business and trying to make every day productive.",
    "He types fast on his phone or speaks voice notes that were transcribed by a machine, so entries contain typos, run-on sentences, filler words and repeated words or phrases (transcription often repeats a word or a whole phrase several times).",
    "For each entry, write the clean version of exactly what he said:",
    "- Remove every repetition: stuttered or doubled words, phrases said twice, the same idea restated in a row, and transcription glitches.",
    "- Remove filler: um, uh, like, you know, I mean, so yeah, basically, right?, euh, genre, en fait, du coup, voilà (when used as filler).",
    "- Fix spelling, grammar and punctuation. Break run-on speech into clear sentences.",
    "- Format it well: if an entry is long or covers several things, split it into short paragraphs (one topic each), separated by a blank line (\\n\\n). No bullet points, no headings, no markdown.",
    "- Keep his voice, first person, his meaning, and every fact, name, number and feeling. Do not summarise or shorten beyond removing repetition and filler. Never add events, feelings, advice or details he did not say.",
    "- Keep the language he used (English, French or mixed). Write Islamic terms properly and consistently: Subh, Dhuhr, Jumuʿah, Asr, Maghrib, Isha, takbīr, khuṭbah, juz, ḥifẓ, murājaʿa, Seerah, in shāʾ Allāh, al-ḥamdu lillāh, mā shāʾ Allāh, subḥān Allāh, the Prophet ﷺ.",
    "- Return exactly one polished entry per input entry, in the same order, with the same time.",
    "",
    "Then judge the day as a whole, mainly from the tone and content of his writing (the scores are secondary context):",
    '- "good": mostly positive, productive or peaceful.',
    '- "hard_good": difficult, tiring or painful, but he pushed through, learned, grew or it ended well.',
    '- "hard": mostly struggle, low mood, or things went badly, without a positive turn.',
    "Give a title of at most 6 words, and a summary of 1–2 warm sentences written to him (\"You…\"), in the language he mostly wrote in.",
    "",
    `Date: ${meta.longDate || ""} (${meta.hijri || ""}). App score: ${meta.score ?? "?"}/100 (salah ${meta.salah ?? "?"}/40, Qur'an ${meta.quran ?? "?"}/30, productivity ${meta.work ?? "?"}/20, walk ${meta.walk ?? "?"}/10).${meta.bonusList ? " Extra voluntary deeds: " + meta.bonusList + "." : ""}`,
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
const VOICE_VOCAB = "Alhamdulillah, SubhanAllah, Bismillah, In sha Allah, Masha Allah, Subh, Fajr, Dhuhr, Asr, Maghrib, Isha, takbir, tahajjud, witr, duha, adhkar, rawatib, juz, hifz, Qur'an, Mushaf, Al-Mulk, masjid, Jumuah, khutbah, Seerah, tafsir, muraja'a, MuslimPreneur, LinkedIn, Conakry, Bruxelles.";

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

/**
 * Writes one day. With the Google Docs API service on, every day is a tab in that month's Doc
 * ("Muhasaba · November 2026"), so Drive holds one Doc per month instead of one per day.
 * Without it (or if that fails), the day gets its own Doc as before.
 */
function writeDoc(docId, tabId, date, meta, original, polished, shukrRaw, shukrOut, verdict, title, summary, usedAI) {
  if (hasDocsApi()) {
    try {
      const t = dayTab(date, verdict, title);
      const doc = DocumentApp.openById(t.docId);
      const tab = doc.getTab(t.tabId);
      fillDay(tab.asDocumentTab().getBody(), date, meta, original, polished, shukrRaw, shukrOut, verdict, title, summary, usedAI);
      doc.saveAndClose();
      // The day used to have its own Doc: it now lives in the month Doc, so the old one goes to the bin.
      if (docId && docId !== t.docId && !tabId) trashOld(docId);
      return { docId: t.docId, tabId: t.tabId };
    } catch (err) {
      console.error("Month Doc failed, writing a single Doc", err);
      MEDIA_ERRORS.push("Couldn't write in the month Doc: " + String(err && err.message || err).slice(0, 160));
    }
  }
  let doc = null;
  if (docId && !tabId) { try { doc = DocumentApp.openById(docId); } catch (e) { doc = null; } }
  const name = `Muhasaba · ${date} · ${meta.longDate || ""}`.trim();
  if (!doc) {
    doc = DocumentApp.create(name);
    const file = DriveApp.getFileById(doc.getId());
    file.moveTo(journalFolder());
  } else {
    doc.setName(name);
  }
  const body = doc.getBody();
  try { body.setMarginTop(48).setMarginBottom(48).setMarginLeft(56).setMarginRight(56); } catch (e) { /* margins are per Doc */ }
  fillDay(body, date, meta, original, polished, shukrRaw, shukrOut, verdict, title, summary, usedAI);
  doc.saveAndClose();
  return { docId: doc.getId(), tabId: "" };
}

/** The day's page: title, rating, timeline with photos, shukr, and the original notes. */
function fillDay(body, date, meta, original, polished, shukrRaw, shukrOut, verdict, title, summary, usedAI) {
  body.clear();
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
  const sub = [meta.hijri, nPh ? `📷 ${nPh}` : "", nVid ? `🎬 ${nVid}` : "", meta.score != null ? `Score ${Math.round(meta.score)}/100` : "", meta.portion ? `Ḥifẓ pages ${meta.portion}` : "", meta.hours ? `${meta.hours}h productive` : "", meta.steps ? `${Number(meta.steps).toLocaleString()} steps` : ""]
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
      // Time on its own small line, then the entry in short paragraphs (the AI splits long voice notes by topic).
      const tl = body.appendParagraph(time || "·");
      tl.setAttributes(Object.assign({}, base, { [DocumentApp.Attribute.FONT_FAMILY]: "Roboto", [DocumentApp.Attribute.FONT_SIZE]: 9.5, [DocumentApp.Attribute.BOLD]: true, [DocumentApp.Attribute.FOREGROUND_COLOR]: "#B97A12" }));
      tl.setSpacingBefore(10).setSpacingAfter(2).setLineSpacing(1);
      const paras = String(e.text || "").replace(/\r/g, "").split(/\n\s*\n|\n/).map((x) => x.trim()).filter(Boolean);
      let p = tl;
      paras.forEach((t) => { p = body.appendParagraph(t); p.setAttributes(base).setSpacingBefore(0).setSpacingAfter(6); });
      p.setSpacingAfter(8);
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
}

/* ------------------------------------------------------------------ one Doc per month, a tab per day */

/** True once the "Google Docs API" service is added in the Apps Script editor (Services ＋ on the left). */
function hasDocsApi() {
  try { return typeof Docs !== "undefined" && !!Docs.Documents; } catch (e) { return false; }
}
function docsBatch(id, requests) { return Docs.Documents.batchUpdate({ requests: requests }, id); }

const MONTHS_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_FR = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const WD_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WD_FR = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const WDL_FR = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
function keyParts(k) {
  const [y, m, d] = String(k).split("-").map(Number);
  return { y: y, m: m, d: d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}
function monthLabel(ym, fr) {
  const [y, m] = ym.split("-").map(Number);
  const n = (fr ? MONTHS_FR : MONTHS_EN)[m - 1];
  return `${n.charAt(0).toUpperCase() + n.slice(1)} ${y}`;
}
function dayLabel(k, fr) { const p = keyParts(k); return `${(fr ? WD_FR : WD_EN)[p.wd]} ${p.d}`; }
/** "Saturday 21 November 2026" / "samedi 21 novembre 2026" */
function longKey(k, fr) {
  const p = keyParts(k);
  return fr ? `${WDL_FR[p.wd]} ${p.d} ${MONTHS_FR[p.m - 1]} ${p.y}` : `${WEEKDAYS[p.wd]} ${p.d} ${MONTHS_EN[p.m - 1]} ${p.y}`;
}
function tabTitle(date, verdict, title) {
  const v = verdict && VERDICT[verdict] ? VERDICT[verdict].dot + " " : "";
  const t = `${v}${dayLabel(date, appCtx().fr)}${title ? " · " + title : ""}`;
  return t.length > 60 ? t.slice(0, 59) + "…" : t;
}

function monthReg(ym) {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty("JM_" + ym) || "null"); } catch (e) { return null; }
}
function saveMonthReg(ym, reg) { PropertiesService.getScriptProperties().setProperty("JM_" + ym, JSON.stringify(reg)); }
function trashOld(id) { try { DriveApp.getFileById(id).setTrashed(true); } catch (e) { /* already gone */ } }

/** The month's Doc, made the first time it's needed. Its first tab is a contents page for the month. */
function monthDoc(ym) {
  let reg = monthReg(ym);
  if (reg) { try { if (DriveApp.getFileById(reg.doc).isTrashed()) reg = null; } catch (e) { reg = null; } }
  if (reg) return reg;
  const label = monthLabel(ym, appCtx().fr);
  const doc = DocumentApp.create(`Muhasaba · ${label}`);
  try { doc.getBody().setMarginTop(48).setMarginBottom(48).setMarginLeft(56).setMarginRight(56); } catch (e) { /* ok */ }
  const cover = doc.getTabs()[0].getId();
  doc.saveAndClose();
  DriveApp.getFileById(doc.getId()).moveTo(journalFolder());
  reg = { doc: doc.getId(), cover: cover, tabs: {} };
  saveMonthReg(ym, reg);
  docsBatch(reg.doc, [{ updateDocumentTabProperties: { tabProperties: { tabId: cover, title: "📅 " + label }, fields: "title" } }]);
  return reg;
}

/** The day's tab in its month Doc (made if needed, kept in date order), renamed to show the rating and title. */
function dayTab(date, verdict, title) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const ym = date.slice(0, 7);
    const reg = monthDoc(ym);
    const name = tabTitle(date, verdict, title);
    let tabId = reg.tabs[date];
    if (tabId) {
      try { docsBatch(reg.doc, [{ updateDocumentTabProperties: { tabProperties: { tabId: tabId, title: name }, fields: "title" } }]); }
      catch (e) { delete reg.tabs[date]; tabId = null; } // the tab was deleted by hand: make it again
    }
    if (!tabId) {
      const index = 1 + Object.keys(reg.tabs).filter((d) => d < date).length;
      let r;
      try { r = docsBatch(reg.doc, [{ addDocumentTab: { tabProperties: { title: name, index: index } } }]); }
      catch (e) { r = docsBatch(reg.doc, [{ addDocumentTab: { tabProperties: { title: name } } }]); }
      tabId = r.replies[0].addDocumentTab.tabProperties.tabId;
      reg.tabs[date] = tabId;
      saveMonthReg(ym, reg);
    }
    return { docId: reg.doc, tabId: tabId, ym: ym };
  } finally {
    lock.releaseLock();
  }
}

/** The month's first tab: every day with its rating, title and summary, each one a link to its tab. */
function refreshCover(ym) {
  const reg = monthReg(ym);
  if (!reg) return;
  const fr = appCtx().fr;
  const sh = storeSheet();
  const info = {};
  if (sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, SCOLS.length).getValues().forEach((r) => {
      const d = String(r[0]);
      if (!reg.tabs[d]) return;
      let meta = {};
      try { meta = JSON.parse(r[S("meta") - 1] || "{}"); } catch (e) { /* ignore */ }
      info[d] = { verdict: r[S("verdict") - 1], title: r[S("title") - 1], summary: r[S("summary") - 1], meta: meta };
    });
  }
  const doc = DocumentApp.openById(reg.doc);
  const tab = doc.getTab(reg.cover);
  if (!tab) { doc.saveAndClose(); return; }
  const body = tab.asDocumentTab().getBody();
  body.clear();
  const A = DocumentApp.Attribute;
  const st = (o) => { const x = {}; Object.keys(o).forEach((k) => (x[A[k]] = o[k])); return x; };
  const dates = Object.keys(reg.tabs).sort();
  const first = body.getParagraphs()[0];
  first.setText(monthLabel(ym, fr)).setHeading(DocumentApp.ParagraphHeading.TITLE);
  first.setAttributes(st({ FONT_FAMILY: "Poppins", FONT_SIZE: 28, BOLD: true, FOREGROUND_COLOR: C.night }));
  const counts = { good: 0, hard_good: 0, hard: 0 };
  const scores = [];
  dates.forEach((d) => {
    const i = info[d] || {};
    if (counts[i.verdict] != null) counts[i.verdict]++;
    if (i.meta && i.meta.score !== "" && i.meta.score != null && !isNaN(Number(i.meta.score))) scores.push(Number(i.meta.score));
  });
  const sub = [fr ? `${dates.length} jour${dates.length > 1 ? "s" : ""} écrit${dates.length > 1 ? "s" : ""}` : `${dates.length} day${dates.length > 1 ? "s" : ""} written`]
    .concat(Object.keys(counts).filter((k) => counts[k]).map((k) => `${VERDICT[k].dot} ${counts[k]}`))
    .concat(scores.length ? [`${fr ? "score moyen" : "average score"} ${Math.round(avgOf(scores))}/100`] : []).join("   ·   ");
  body.appendParagraph(sub).setAttributes(st({ FONT_FAMILY: "Roboto", FONT_SIZE: 10.5, BOLD: false, FOREGROUND_COLOR: "#6A6688" }));
  body.appendParagraph(fr ? "Chaque jour a son onglet à gauche. Touche un jour ci-dessous pour l'ouvrir." : "Every day has its own tab on the left. Tap a day below to open it.")
    .setAttributes(st({ FONT_FAMILY: "Roboto", FONT_SIZE: 9.5, ITALIC: true, BOLD: false, FOREGROUND_COLOR: "#8A86A6" })).setSpacingAfter(16);
  dates.forEach((d) => {
    const i = info[d] || {};
    const v = i.verdict && VERDICT[i.verdict];
    const p = body.appendParagraph("");
    p.setAttributes(st({ FONT_FAMILY: "Lora", FONT_SIZE: 12, BOLD: false, ITALIC: false, FOREGROUND_COLOR: C.night })).setSpacingBefore(6).setSpacingAfter(i.summary ? 1 : 6);
    p.appendText(v ? v.dot + "  " : "⚪  ");
    p.appendText(longKey(d, fr)).setLinkUrl(docUrl(reg.doc, reg.tabs[d])).setBold(true).setForegroundColor(C.violet);
    if (i.title) p.appendText("  —  " + i.title).setLinkUrl(null).setBold(false).setForegroundColor(C.night);
    if (i.meta && i.meta.score !== "" && i.meta.score != null && !isNaN(Number(i.meta.score))) {
      p.appendText(`   ${Math.round(Number(i.meta.score))}/100`).setLinkUrl(null).setBold(false).setFontSize(9.5).setForegroundColor("#8A86A6");
    }
    if (i.summary) {
      body.appendParagraph(String(i.summary)).setAttributes(st({ FONT_FAMILY: "Lora", FONT_SIZE: 10, BOLD: false, ITALIC: false, FOREGROUND_COLOR: "#6A6688" }))
        .setIndentStart(24).setIndentFirstLine(24).setSpacingAfter(8);
    }
  });
  doc.saveAndClose();
}

/** Copies a whole Doc body (text, tables, photos) into another body. */
function copyBody(src, dst) {
  dst.clear();
  const T = DocumentApp.ElementType;
  for (let i = 0; i < src.getNumChildren(); i++) {
    const el = src.getChild(i).copy(), t = el.getType();
    if (t === T.PARAGRAPH) dst.appendParagraph(el.asParagraph());
    else if (t === T.LIST_ITEM) dst.appendListItem(el.asListItem());
    else if (t === T.TABLE) dst.appendTable(el.asTable());
  }
  const f = dst.getChild(0);
  if (dst.getNumChildren() > 1 && f.getType() === T.PARAGRAPH && !f.asParagraph().getText() && f.asParagraph().getNumChildren() === 0) f.removeFromParent();
}

/**
 * Moves every older day (one Doc each) into its month Doc as a tab, then puts the old Doc in the Drive bin
 * (recoverable for 30 days). Works in batches: whatever doesn't fit in one run continues every hour.
 */
function organiseJournal(auto) {
  const p = PropertiesService.getScriptProperties();
  if (!hasDocsApi()) return { ok: false, moved: 0, left: 0 };
  const sh = storeSheet();
  if (sh.getLastRow() < 2) { p.deleteProperty("ORGANISE_LEFT"); return { ok: true, moved: 0, left: 0 }; }
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, SCOLS.length).getValues();
  const start = Date.now(), budget = auto ? 120000 : 270000;
  const months = {};
  let moved = 0, left = 0;
  rows.forEach((r, i) => {
    const date = String(r[0]), docId = r[S("docId") - 1], tabId = r[S("tabId") - 1];
    if (!docId || tabId) return;
    if (Date.now() - start > budget) { left++; return; }
    let src;
    try { src = DocumentApp.openById(docId); }
    catch (err) {
      // The old Doc was deleted by hand: nothing to copy, so the day is written again on the next polish.
      sh.getRange(i + 2, S("docId")).setValue("");
      sh.getRange(i + 2, S("processedHash")).setValue("");
      return;
    }
    try {
      const verdict = r[S("verdict") - 1], title = r[S("title") - 1], summary = r[S("summary") - 1];
      const t = dayTab(date, verdict, title);
      const doc = DocumentApp.openById(t.docId);
      copyBody(src.getBody(), doc.getTab(t.tabId).asDocumentTab().getBody());
      doc.saveAndClose();
      sh.getRange(i + 2, S("docId")).setValue(t.docId);
      sh.getRange(i + 2, S("tabId")).setValue(t.tabId);
      setManaged(date, verdict, docUrl(t.docId, t.tabId), title ? `${title}. ${summary}` : summary);
      trashOld(docId);
      months[t.ym] = 1;
      moved++;
    } catch (err) { console.error("Organise", date, err); left++; }
  });
  Object.keys(months).forEach((ym) => { try { refreshCover(ym); } catch (e) { console.warn("Cover", e); } });
  if (left) p.setProperty("ORGANISE_LEFT", String(left)); else p.deleteProperty("ORGANISE_LEFT");
  return { ok: true, moved: moved, left: left };
}

function organiseJournalMenu() {
  const ui = SpreadsheetApp.getUi();
  if (!hasDocsApi()) {
    ui.alert("One step first", "In the Apps Script editor (Extensions → Apps Script), click the ＋ next to “Services” on the left, choose “Google Docs API”, click Add, then run this again.", ui.ButtonSet.OK);
    return;
  }
  const r = organiseJournal(false);
  ui.alert("Journal organised", `${r.moved} day${r.moved === 1 ? "" : "s"} moved into monthly Docs, one tab per day. The old daily Docs are in your Drive bin for 30 days in case you want one back.` +
    (r.left ? `\n\n${r.left} more will move by themselves over the next hours.` : ""), ui.ButtonSet.OK);
}

function lettersFolder() {
  const parent = journalFolder();
  const it = parent.getFoldersByName("Weekly letters");
  return it.hasNext() ? it.next() : parent.createFolder("Weekly letters");
}

/** Where this week's letter goes: a new tab (newest first) in the year's "Weekly letters" Doc. */
function letterTarget(endK, week) {
  const tabName = `✉️ ${week}`;
  if (hasDocsApi()) {
    try {
      const y = endK.slice(0, 4), key = "WL_" + y, p = PropertiesService.getScriptProperties();
      let reg = null;
      try { reg = JSON.parse(p.getProperty(key) || "null"); } catch (e) { reg = null; }
      if (reg) { try { if (DriveApp.getFileById(reg.doc).isTrashed()) reg = null; } catch (e) { reg = null; } }
      let tabId;
      if (!reg) {
        const d = DocumentApp.create(`Muhasaba · ${appCtx().fr ? "Lettres de la semaine" : "Weekly letters"} ${y}`);
        tabId = d.getTabs()[0].getId();
        d.saveAndClose();
        DriveApp.getFileById(d.getId()).moveTo(lettersFolder());
        reg = { doc: d.getId() };
        p.setProperty(key, JSON.stringify(reg));
        docsBatch(reg.doc, [{ updateDocumentTabProperties: { tabProperties: { tabId: tabId, title: tabName }, fields: "title" } }]);
      } else {
        const r = docsBatch(reg.doc, [{ addDocumentTab: { tabProperties: { title: tabName, index: 0 } } }]);
        tabId = r.replies[0].addDocumentTab.tabProperties.tabId;
      }
      const doc = DocumentApp.openById(reg.doc);
      return { doc: doc, body: doc.getTab(tabId).asDocumentTab().getBody(), url: docUrl(reg.doc, tabId) };
    } catch (err) { console.error("Letter tab failed, using its own Doc", err); }
  }
  const doc = DocumentApp.create(`Muhasaba · Week of ${week}`);
  DriveApp.getFileById(doc.getId()).moveTo(lettersFolder());
  return { doc: doc, body: doc.getBody(), url: doc.getUrl() };
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

/**
 * Finds a photo or video already in Drive by its app id (e.g. uploaded from another copy of the app),
 * so a phone that doesn't have the file itself can still link to it.
 */
function findMedia(m) {
  const id = String(m && m.id || "");
  if (!/^p[a-z0-9]{4,26}$/.test(id)) throw new Error("Bad id");
  const folder = m.kind === "video" ? videoFolder() : photoFolder();
  const it = folder.searchFiles(`title contains '${id}' and trashed = false`);
  while (it.hasNext()) {
    const f = it.next();
    if (f.getName().indexOf(`· ${id}.`) >= 0) return { drive: f.getId() };
  }
  return {};
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
  futureSheet();
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === "processJournals").forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("processJournals").timeBased().everyMinutes(15).create();
  // One hourly heartbeat: nightly reminder email, Insights refresh, Sunday weekly letter.
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === "tick").forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("tick").timeBased().everyHours(1).create();
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === "onInsightsEdit").forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("onInsightsEdit").forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  buildInsights();
  buildUpdates();
  SpreadsheetApp.getActive().setActiveSheet(SpreadsheetApp.getActive().getSheetByName(DASH));
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Muhasaba")
    .addItem("Set AI key…", "setAiKey")
    .addItem("Polish journals now", "processAllNow")
    .addItem("Polish all journals again", "repolishAllMenu")
    .addItem("Open journal folder", "showFolder")
    .addItem("Organise journal: one Doc per month, a tab per day", "organiseJournalMenu")
    .addSeparator()
    .addItem("Future me: letters waiting", "futureStatusMenu")
    .addItem("Future me: send me a sample letter now", "testFutureLetter")
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
      const from = COLUMNS.map(([h]) => { let i = oldHead.indexOf(h); (HEADER_ALIASES[h] || []).forEach((a) => { if (i < 0) i = oldHead.indexOf(a); }); return i; });
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
  ["energy", "mood", "excused", "revised", "rules"].forEach((k) => body(k).setHorizontalAlignment("center").setNumberFormat("0"));
  body("khushu").setNumberFormat('0"%"').setHorizontalAlignment("center");
  ["khushuNote", "workout", "tathbit", "sc"].forEach((k) => body(k).setWrap(true));
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
    ["salah", "quran", "work", "walk", "bonus", "pages", "minutes", "hours", "steps", "sleepH", "energy", "mood", "revised", "excused", "salawat", "tasbih"].forEach((k) => {
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
const PERIODS = ["All time", "Last 90 days", "Last 30 days", "Last 7 days"];
const PERIOD_CELL = "D4";

/** Changing the period dropdown on the Insights tab rebuilds it (installed by setup). */
function onInsightsEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() === INSIGHTS && e.range.getA1Notation() === PERIOD_CELL) buildInsights();
}

/**
 * Rebuilds the Insights tab: a banner with a period dropdown, headline tiles, then sections of tables with
 * colour scales and a chart under each one that has numbers worth seeing. Computed fresh from the Log.
 */
function buildInsights() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(INSIGHTS);
  let period = PERIODS[0];
  if (sh) { const v = String(sh.getRange(PERIOD_CELL).getValue() || ""); if (PERIODS.indexOf(v) >= 0) period = v; }
  if (!sh) sh = ss.insertSheet(INSIGHTS, 1);
  sh.getCharts().forEach((c) => sh.removeChart(c));
  const f0 = sh.getFilter(); if (f0) f0.remove();
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  sh.clear();
  sh.clearConditionalFormatRules();
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations();
  sh.setHiddenGridlines(true);
  sh.setTabColor(C.green);
  sh.setFrozenRows(0);
  const NC = 10; // A margin, B..I content, J margin
  if (sh.getMaxColumns() < NC) sh.insertColumnsAfter(sh.getMaxColumns(), NC - sh.getMaxColumns());
  if (sh.getMaxRows() < 600) sh.insertRowsAfter(sh.getMaxRows(), 600 - sh.getMaxRows());
  [18, 170, 112, 112, 112, 112, 112, 112, 112, 18].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.setRowHeights(1, sh.getMaxRows(), 24);
  sh.getRange(1, 1, sh.getMaxRows(), NC).setFontFamily("Roboto").setFontSize(10).setVerticalAlignment("middle").setFontColor("#2A2840");
  const W = 8; // content columns B..I
  const CHART_W = 170 + 112 * 7 - 10;

  let days = readDays();
  const ctx = appCtx();
  const today0 = Utilities.formatDate(new Date(), ctx.tz, "yyyy-MM-dd");
  const cutDays = { "Last 90 days": 90, "Last 30 days": 30, "Last 7 days": 7 }[period];
  if (cutDays) days = days.filter((d) => d.key > shiftKey(today0, -cutDays));

  // Banner
  sh.setRowHeight(1, 10);
  sh.getRange(2, 2, 3, W).setBackground(C.night);
  sh.setRowHeight(2, 46);
  sh.getRange(2, 2, 1, W).merge().setValue("Insights").setFontSize(24).setFontWeight("bold").setFontColor("#FFFFFF").setFontFamily("Montserrat").setVerticalAlignment("bottom");
  sh.getRange(3, 2, 1, W).merge()
    .setValue(`${days.length} days · updated ${Utilities.formatDate(new Date(), ctx.tz, "EEE d MMM, HH:mm")} · rebuilt every night`)
    .setFontColor("#BDB8E6").setFontSize(10);
  sh.setRowHeight(4, 32);
  sh.getRange(4, 2, 1, 2).merge().setValue("Period ▸").setFontColor("#FFFFFF").setFontWeight("bold").setHorizontalAlignment("right");
  sh.getRange(PERIOD_CELL).setValue(period).setBackground("#FFFFFF").setFontColor(C.night).setFontWeight("bold").setHorizontalAlignment("center")
    .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(PERIODS, true).setAllowInvalid(false).build());
  sh.getRange(4, 5, 1, W - 3).merge().setValue("← change it and the whole tab recalculates").setFontColor("#BDB8E6").setFontSize(9).setFontStyle("italic");
  let row = 6;

  const SECTION_COLORS = { violet: [C.violet, C.violetSoft], gold: [C.gold, C.goldSoft], green: [C.green, C.greenSoft], red: [C.red, C.redSoft] };
  let tone = SECTION_COLORS.violet;

  /** A coloured band that opens a group of tables. */
  const section = (icon, title, color) => {
    tone = SECTION_COLORS[color || "violet"];
    row++;
    sh.setRowHeight(row, 38);
    sh.getRange(row, 2).setBackground(tone[0]).setValue(icon).setFontSize(16).setHorizontalAlignment("center");
    sh.getRange(row, 3, 1, W - 1).merge().setValue(title).setBackground(tone[1]).setFontSize(15).setFontWeight("bold").setFontColor(C.night).setFontFamily("Montserrat");
    row += 2;
  };

  /** Headline tiles, four per row. Each: [label, value, sub, colour]. */
  const tiles = (list) => {
    for (let i = 0; i < list.length; i += 4) {
      list.slice(i, i + 4).forEach((t, j) => {
        const c = 2 + j * 2;
        const col = SECTION_COLORS[t[3] || "violet"];
        const box = sh.getRange(row, c, 3, 2);
        box.setBackground(col[1]).setBorder(true, true, true, true, false, false, "#FFFFFF", SpreadsheetApp.BorderStyle.SOLID_THICK);
        sh.getRange(row, c, 1, 2).merge().setValue(String(t[0]).toUpperCase()).setFontSize(8).setFontWeight("bold").setFontColor("#6A6688").setVerticalAlignment("bottom");
        sh.getRange(row + 1, c, 1, 2).merge().setValue(t[1] == null ? "–" : t[1]).setFontSize(22).setFontWeight("bold").setFontColor(col[0]).setFontFamily("Montserrat").setHorizontalAlignment("left");
        sh.getRange(row + 2, c, 1, 2).merge().setValue(t[2] || "").setFontSize(9).setFontColor("#6A6688").setVerticalAlignment("top");
      });
      sh.setRowHeight(row, 22); sh.setRowHeight(row + 1, 38); sh.setRowHeight(row + 2, 22);
      row += 3;
    }
    row++;
  };

  /**
   * One titled table. `marks` colours rows { index: "good" | "bad" }. `opt.scale` lists column indexes that get
   * a red→green colour scale (`opt.reverse` for lower-is-better). `opt.chart` draws a chart under the table:
   * { type: "column" | "bar" | "line" | "pie", cols: [column indexes], title, max }.
   */
  const block = (title, note, head, rows, marks, opt) => {
    opt = opt || {};
    sh.getRange(row, 2, 1, W).merge().setValue(title).setFontSize(12.5).setFontWeight("bold").setFontColor(C.night);
    sh.setRowHeight(row, 28);
    row++;
    if (note) {
      sh.getRange(row, 2, 1, W).merge().setValue(note).setFontColor("#6A6688").setFontStyle("italic").setWrap(true).setVerticalAlignment("top");
      sh.setRowHeight(row, note.length > 120 ? 40 : 22);
      row++;
    }
    if (!rows || !rows.length) { row++; return null; }
    const w = head.length;
    const span = (i) => (i === w - 1 ? W - (w - 1) : 1); // the last column stretches to the right edge
    sh.getRange(row, 2, 1, W).setBackground(tone[1]);
    head.forEach((h, i) => { const r = sh.getRange(row, 2 + i, 1, span(i)); if (span(i) > 1) r.merge(); r.setValue(h); });
    sh.getRange(row, 2, 1, W).setFontWeight("bold").setFontColor(C.night).setFontSize(9.5)
      .setBorder(null, null, true, null, null, null, tone[0], SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    sh.getRange(row, 3, 1, W - 1).setHorizontalAlignment("center");
    const top = row;
    const start = row + 1;
    const data = rows.map((r) => head.map((_, i) => (r[i] == null ? "" : r[i])));
    if (w > 1) sh.getRange(start, 2, data.length, w - 1).setValues(data.map((r) => r.slice(0, w - 1)));
    data.forEach((r, k) => {
      const c = sh.getRange(start + k, 2 + w - 1, 1, span(w - 1)); if (span(w - 1) > 1) c.merge(); c.setValue(r[w - 1]);
      const lineR = sh.getRange(start + k, 2, 1, W);
      lineR.setBackground(k % 2 ? C.band : "#FFFFFF").setBorder(null, null, true, null, null, null, "#ECE9F5", SpreadsheetApp.BorderStyle.SOLID);
      const longest = Math.max(...r.map((v) => String(v).length));
      if (longest > 40) { lineR.setWrap(true); sh.setRowHeight(start + k, Math.min(70, 24 + Math.floor(longest / 70) * 14)); }
    });
    sh.getRange(start, 2, data.length, 1).setFontWeight("bold").setHorizontalAlignment("left");
    sh.getRange(start, 3, data.length, W - 1).setHorizontalAlignment("center");
    if (w > 2 && data.some((r) => String(r[w - 1]).length > 30)) sh.getRange(start, 2 + w - 1, data.length, span(w - 1)).setHorizontalAlignment("left");
    Object.keys(marks || {}).forEach((i) => {
      const m = marks[i];
      sh.getRange(start + Number(i), 2, 1, W).setBackground(m === "good" ? C.greenSoft : C.redSoft);
      sh.getRange(start + Number(i), 2).setFontColor(m === "good" ? C.green : C.red).setValue((m === "good" ? "▲ " : "▼ ") + data[Number(i)][0]);
    });
    const rules = sh.getConditionalFormatRules();
    (opt.scale || []).forEach((ci) => {
      const rg = sh.getRange(start, 2 + ci, data.length, 1);
      const b2 = SpreadsheetApp.newConditionalFormatRule().setRanges([rg]);
      if (opt.reverse) b2.setGradientMinpoint("#CDEFE0").setGradientMidpointWithValue("#FFF6DD", SpreadsheetApp.InterpolationType.PERCENTILE, "50").setGradientMaxpoint("#F9D4CB");
      else b2.setGradientMinpoint("#F9D4CB").setGradientMidpointWithValue("#FFF6DD", SpreadsheetApp.InterpolationType.PERCENTILE, "50").setGradientMaxpoint("#CDEFE0");
      rules.push(b2.build());
    });
    sh.setConditionalFormatRules(rules);
    row = start + data.length + 1;
    const chartable = opt.chart && data.filter((r) => opt.chart.cols.some((ci) => typeof r[ci] === "number")).length >= 2;
    if (chartable) {
      const ch = opt.chart;
      const height = ch.type === "pie" ? 260 : 230;
      let bld = sh.newChart();
      bld = ch.type === "line" ? bld.asLineChart() : ch.type === "bar" ? bld.asBarChart() : ch.type === "pie" ? bld.asPieChart() : bld.asColumnChart();
      bld = bld.addRange(sh.getRange(top, 2, data.length + 1, 1));
      ch.cols.forEach((ci) => { bld = bld.addRange(sh.getRange(top, 2 + ci, data.length + 1, 1)); });
      bld = bld.setNumHeaders(1).setPosition(row, 2, 0, 0)
        .setOption("title", ch.title || "").setOption("titleTextStyle", { color: C.night, fontSize: 12, bold: true })
        .setOption("width", CHART_W).setOption("height", height)
        .setOption("colors", ch.colors || [tone[0], C.gold, C.green, "#5AB0F0"])
        .setOption("legend", { position: ch.cols.length > 1 || ch.type === "pie" ? "right" : "none" })
        .setOption("backgroundColor", "#FFFFFF").setOption("chartArea", { width: "82%", height: "70%" })
        .setOption("animation", { duration: 600, startup: true });
      if (ch.type !== "pie") bld = bld.setOption("vAxis", ch.max ? { viewWindow: { min: 0, max: ch.max }, gridlines: { color: "#EEEAF7" } } : { minValue: 0, gridlines: { color: "#EEEAF7" } });
      if (ch.type === "pie") bld = bld.setOption("pieHole", 0.45);
      sh.insertChart(bld.build());
      row += Math.ceil(height / 24) + 1;
    }
    return { start, end: start + data.length - 1, top };
  };
  const needs = (title, have, need, what) => block(title, `Needs ${need - have} more ${what} before this means anything (${have}/${need}). It fills in by itself as you log.`, [], []);

  if (!days.length) { section("📭", "Nothing to show for this period", "violet"); block("Log a few days in the app and this tab fills itself.", "", [], []); return; }

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
  const last7 = avgOf(within(7).map((d) => d.score)), prev7 = avgOf(days.filter((d) => d.key > shiftKey(today, -14) && d.key <= shiftKey(today, -7)).map((d) => d.score));
  const kAll = days.filter((d) => typeof d.khushu === "number");
  const sl = days.filter((d) => d.sleepH != null);
  const delta = last7 != null && prev7 != null ? `${last7 >= prev7 ? "▲" : "▼"} ${r1(Math.abs(last7 - prev7))} vs the week before` : "this week";
  tiles([
    ["Average score", r1(avgOf(scores)), `${days.length} days`, "violet"],
    ["Last 7 days", r1(last7), delta, last7 != null && prev7 != null && last7 < prev7 ? "red" : "green"],
    ["Best day", r1(top.score), Utilities.formatDate(top.d, ctx.tz, "EEE d MMM"), "green"],
    ["Hardest day", r1(low.score), Utilities.formatDate(low.d, ctx.tz, "EEE d MMM"), "red"],
    ["Streak 70+", `${cur} d`, `best ${best} days`, "gold"],
    ["Khushūʿ", kAll.length ? r0(avgOf(kAll.map((d) => d.khushu))) + "%" : "–", kAll.length ? `${kAll.length} days logged` : "log it after prayers", "violet"],
    ["Sleep", sl.length ? r1(avgOf(sl.map((d) => d.sleepH))) + " h" : "–", sl.length ? "average a night" : "from the check-in", "gold"],
    ["Pages memorised", days.reduce((n, d) => n + (d.pages || 0), 0), "in this period", "green"],
  ]);
  section("📅", "Your days", "violet");

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
  block("By day of the week", wdNote, ["Day", "Days", "Avg score", "Salah /40", "Qur'an /30", "Productive /20", "Health /10"], wd.map((x) => x.row), wdMarks,
    { scale: [2], chart: { type: "column", cols: [2], title: "Average score by weekday", max: 100 } });

  /* ---- Best & worst days ---- */
  const line = (d) => [Utilities.formatDate(d.d, ctx.tz, "EEE d MMM yyyy"), r1(d.score), d.dayType || "", String(d.summary || "").slice(0, 160)];
  const sorted = days.slice().sort((a, b) => b.score - a.score);
  block("Your 5 best days", "", ["Date", "Score", "Day type", "The day in a line"], sorted.slice(0, 5).map(line));
  block("Your 5 hardest days", "", ["Date", "Score", "Day type", "The day in a line"], sorted.slice(-5).reverse().map(line));

  /* ---- Rebound ---- */
  section("🔁", "Bad days: how you respond, and what comes with them", "red");
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
    section("😴", "Sleep, phone, energy, mood", "gold");
    block("Score by hours of sleep", "", ["Sleep", "Days", "Avg score", "Salah", "Qur'an"], sleepRows, hiLo(sleepRows),
      { scale: [2], chart: { type: "column", cols: [2], title: "Average score by hours of sleep", max: 100 } });
    const bedRows = bucketRows([
      ["Before 23:00", (d) => d.bed != null && d.bed >= 12 * 60 && d.bed < 23 * 60], ["23:00–00:00", (d) => d.bed >= 23 * 60],
      ["00:00–01:00", (d) => d.bed != null && d.bed < 60], ["After 01:00", (d) => d.bed != null && d.bed >= 60 && d.bed < 12 * 60]]);
    block("Score by bedtime (the night before)", "", ["Went to sleep", "Days", "Avg score", "Salah", "Qur'an"], bedRows, hiLo(bedRows),
      { scale: [2], chart: { type: "column", cols: [2], title: "Average score by bedtime", max: 100 } });
    const phoneRows = bucketRows([["None", (d) => d.phone === "None"], ["A bit", (d) => d.phone === "A bit"], ["A lot", (d) => d.phone === "A lot"]]);
    const nextPhone = (v) => r1(avgOf(ck.filter((d) => d.phone === v).map((d) => byKey[shiftKey(d.key, 1)]).filter(Boolean).map((n) => n.score)));
    block("Score by phone & scrolling", `The day after scrolling a lot you average ${nextPhone("A lot")}; after no scrolling, ${nextPhone("None")}.`,
      ["Phone", "Days", "Avg score", "Salah", "Qur'an"], phoneRows, hiLo(phoneRows), { scale: [2], chart: { type: "column", cols: [2], title: "Average score by phone use", max: 100 } });
    const scale = (key2, label) => {
      const rows2 = bucketRows([1, 2, 3, 4, 5].map((n) => [`${label} ${n}/5`, (d) => d[key2] === n]));
      return block(`Score by ${label.toLowerCase()}`, "", [label, "Days", "Avg score", "Salah", "Qur'an"], rows2, hiLo(rows2), { scale: [2] });
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
  section("🕌", "Salah & khushūʿ", "green");
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
      return [r, reasonCount[r].n, `${top2} (${at[top2]}×)`, ["Travelling", "Ill", "Ill / stomach ache", "Menstruation", "Rain / danger"].indexOf(r) >= 0 ? "Yes" : r === "Call of nature" ? "Partly" : "No"];
    }), {}, { chart: { type: "pie", cols: [1], title: "Reasons, all prayers", colors: [C.red, C.gold, C.violet, C.green, "#5AB0F0", "#B07CC6", "#8A86A6", "#E58E73", "#4BB3A8", "#C9A227"] } });

  /* ---- Khushūʿ ---- */
  const kd = days.filter((d) => typeof d.khushu === "number");
  if (kd.length < 3) needs("Khushūʿ", kd.length, 3, "days with khushūʿ logged");
  else {
    const per = PR.map((p) => {
      const hits = kd.map((d) => new RegExp(PRNAME[p] + ": (present|on and off|mostly elsewhere)").exec(String(d.khushuNote || ""))).filter(Boolean).map((m) => ({ "present": 2, "on and off": 1, "mostly elsewhere": 0 })[m[1]]);
      return [PRNAME[p], hits.length, hits.length ? Math.round((hits.reduce((a, b) => a + b, 0) / (hits.length * 2)) * 100) : "–", pc(hits.filter((x) => x === 2).length, hits.length)];
    });
    block("Khushūʿ by prayer", `Average focus over ${kd.length} days: ${r0(avgOf(kd.map((d) => d.khushu)))}% (100 = fully present every time).`, ["Prayer", "Logged", "Focus /100", "Fully present"], per, {},
      { scale: [2], chart: { type: "column", cols: [2], title: "Khushūʿ by prayer (focus /100)", max: 100 } });
    const count = (list) => { const c = {}; kd.forEach((d) => list.forEach((w) => { if (String(d.khushuNote || "").indexOf(w) >= 0) c[w] = (c[w] || 0) + 1; })); return Object.keys(c).sort((a, b) => c[b] - c[a]).map((w) => [w, c[w]]); };
    block("What takes your mind away", "", ["Thought", "Times"], count(["Work / business", "Family", "Phone / social media", "Worries", "Future plans", "Food", "Studies", "A conversation", "Nothing specific"]), {},
      { chart: { type: "bar", cols: [1], title: "Thoughts during prayer", colors: [C.violet] } });
    block("Why focus slipped", "", ["Cause", "Times"], count(["Tired", "Rushed", "Noise / people", "Hungry", "Came in late", "Didn't prepare", "Phone just before", "Long day"]), {},
      { chart: { type: "bar", cols: [1], title: "Causes", colors: [C.gold] } });
    const ksleep = (f) => r0(avgOf(kd.filter(f).map((d) => d.khushu)));
    block("Khushūʿ and your day", "", ["", "Avg focus"], [
      ["After 7 h+ of sleep", ksleep((d) => d.sleepH >= 7) + "%"], ["After under 6 h", ksleep((d) => d.sleepH != null && d.sleepH < 6) + "%"],
      ["Phone: none", ksleep((d) => d.phone === "None") + "%"], ["Phone: a lot", ksleep((d) => d.phone === "A lot") + "%"],
    ]);
  }

  /* ---- Qur'an ---- */
  section("📖", "Qurʾān", "gold");
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
  block("Ḥifẓ at a glance", "", ["", "Value"], qRows);
  const mus = (v) => timed.filter((d) => d.music === v);
  const musRows = [["No music", mus("None")], ["A little", mus("A little")], ["Music", mus("Yes")]].map(([l, xs]) => [l, xs.length, xs.length ? Number(r1(avgOf(xs.map((d) => d.minutes / d.pages)))) : "–"]);
  const musN = musRows.filter((r) => r[1] > 0).length;
  block("Minutes per page, by music the day before", musN < 2
    ? "Answer the music question after memorising (it pops up in the app). Once there are timed days with and without music, they're compared here."
    : (() => { const a = musRows[0][2], b = [musRows[1], musRows[2]].filter((r) => typeof r[2] === "number"); const m = b.length ? avgOf(b.map((r) => r[2])) : null; return typeof a === "number" && m != null ? `Without music the day before: ${a} min a page; after music: ${r1(m)}. ${a < m ? "Less music, faster ḥifẓ." : "No clear gain yet: keep logging."}` : ""; })(),
    ["Day before", "Timed days", "Min / page"], musN ? musRows : [], {}, { scale: [2], reverse: true, chart: { type: "column", cols: [2], title: "Minutes per page by music the day before", colors: [C.green] } });
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const end = shiftKey(today, -7 * i), startK = shiftKey(end, -6);
    const xs = days.filter((d) => d.key >= startK && d.key <= end);
    weeks.push([`Week of ${Utilities.formatDate(new Date(startK + "T12:00:00"), ctx.tz, "d MMM")}`, xs.reduce((n, d) => n + (d.pages || 0), 0), xs.reduce((n, d) => n + (d.revised || 0), 0), r1(xs.reduce((n, d) => n + (d.hours || 0), 0)), r0(avgOf(xs.map((d) => d.steps).filter((v) => v != null))), r1(avgOf(xs.map((d) => d.score)))]);
  }
  block("Week by week (last 8 weeks)", "", ["Week", "Pages", "Revised", "Productive h", "Avg steps", "Avg score"], weeks, {},
    { scale: [5], chart: { type: "column", cols: [1, 2], title: "Pages memorised and revised, per week", colors: [C.gold, C.violet] } });

  /* ---- Work & walk ---- */
  section("⚡", "Productivity & health", "green");
  const topicH = {};
  days.forEach((d) => { const ts = String(d.topics || "").split(",").map((t) => t.trim()).filter(Boolean); ts.forEach((t) => (topicH[t] = (topicH[t] || 0) + (d.hours || 0) / ts.length)); });
  const tk = Object.keys(topicH).sort((a, b) => topicH[b] - topicH[a]);
  const deep = days.filter((d) => d.hours >= 2), little = days.filter((d) => (d.hours || 0) < 1);
  block("Productivity", `Days with 2 h+ of productive time average ${r1(avgOf(deep.map((d) => d.score)))}; days under 1 h average ${r1(avgOf(little.map((d) => d.score)))}.`,
    ["Topic", "Hours (approx.)", "Share"], tk.map((t) => [t, r1(topicH[t]), pc(topicH[t], tk.reduce((n, x) => n + topicH[x], 0))]), {},
    { chart: { type: "pie", cols: [1], title: "Where your productive hours go" } });
  const walked = days.filter((d) => d.steps != null);
  const goal = walked.filter((d) => d.steps >= 8000);
  const wk = days.filter((d) => String(d.workout || "").indexOf("✓") === 0);
  const wkOn = days.filter((d) => Number(d.rules) >= 2);
  block("Walking & workout", "", ["", "Value"], [
    ["Workouts", wkOn.length ? `${wk.length} of ${wkOn.length} days (${pc(wk.length, wkOn.length)})` : "–"],
    ["Avg score on workout days / others", wk.length ? `${r1(avgOf(wk.map((d) => d.score)))} / ${r1(avgOf(wkOn.filter((d) => wk.indexOf(d) < 0).map((d) => d.score)))}` : "–"],
    ["Average steps", r0(avgOf(walked.map((d) => d.steps)))],
    ["Days at 8,000+", `${goal.length} (${pc(goal.length, walked.length)})`],
    ["Avg score on 8k days / other days", `${r1(avgOf(goal.map((d) => d.score)))} / ${r1(avgOf(walked.filter((d) => d.steps < 8000).map((d) => d.score)))}`],
    ["Best walk", walked.length ? `${walked.reduce((a, b) => (b.steps > a.steps ? b : a)).steps.toLocaleString()} steps` : "–"],
  ]);

  /* ---- Months ---- */
  const months = {};
  days.forEach((d) => { const m = d.key.slice(0, 7); (months[m] = months[m] || []).push(d); });
  section("📈", "Over time", "violet");
  block("Month by month", "", ["Month", "Days", "Avg score", "Salah", "Qur'an", "Productive", "Health"], Object.keys(months).sort().map((m) => {
    const xs = months[m], a = (k2) => r1(avgOf(xs.map((d) => d[k2]).filter((v) => v != null)));
    return [Utilities.formatDate(new Date(m + "-15T12:00:00"), ctx.tz, "MMMM yyyy"), xs.length, a("score"), a("salah"), a("quran"), a("work"), a("walk")];
  }), {}, { scale: [2], chart: { type: "line", cols: [2, 3, 4], title: "Score, salah and Qurʾān by month", colors: [C.night, C.violet, C.gold] } });

  /* ---- Day types & bonus ---- */
  block("How your days felt (journal)", "", ["Day type", "Days", "Avg score", "Avg sleep (h)", "Phone a lot"], Object.keys(VERDICT).map((v) => {
    const xs = days.filter((d) => d.dayType === VERDICT[v].label);
    return [VERDICT[v].label, xs.length, r1(avgOf(xs.map((d) => d.score))), r1(avgOf(xs.map((d) => d.sleepH).filter((x) => x != null))), pc(xs.filter((d) => d.phone === "A lot").length, xs.filter((d) => d.phone).length)];
  }), {}, { chart: { type: "pie", cols: [1], title: "Good / hard-but-good / hard days", colors: [C.green, C.gold, C.red] } });
  section("✦", "Voluntary deeds & dhikr", "gold");
  const has = (w) => days.filter((d) => String(d.bonusList || "").indexOf(w) >= 0).length;
  block("Voluntary deeds ✦", "", ["", "Days"], [
    ["Tahajjud", has("Tahajjud")], ["Witr", has("Witr")], ["Ḍuḥā", has("Ḍuḥā")], ["Voluntary fasts", has("Voluntary fast")],
    ["Morning / evening adhkār", `${has("Morning adhkār")} / ${has("Evening adhkār")}`], ["All 12 rawātib", has("Rawātib 12/12")],
    ["Sūrat al-Kahf (Fridays)", `${has("Sūrat al-Kahf")} of ${days.filter((d) => d.d.getDay() === 5).length} Fridays`],
    ["Ṣalawāt on the Prophet ﷺ (Fridays)", days.reduce((n, d) => n + (d.salawat || 0), 0).toLocaleString()],
    ["Subḥān Allāhi l-ʿAẓīm… (other days)", days.reduce((n, d) => n + (d.tasbih || 0), 0).toLocaleString()],
    ["Average bonus per day", r1(avgOf(days.map((d) => d.bonus || 0)))],
  ]);

  /* ---- Weekly letters ---- */
  section("✉️", "Weekly letters", "violet");
  const letters = JSON.parse(PropertiesService.getScriptProperties().getProperty("LETTERS") || "[]");
  block("Your letters", letters.length ? "Written every Sunday evening from your week." : "Your first letter arrives on Sunday evening. Or: Muhasaba menu → Write this week's letter now.",
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
  try { deliverFuture(false); } catch (err) { console.error("Future letters failed", err); }
  if (p.getProperty("ORGANISE_LEFT")) { try { organiseJournal(true); } catch (err) { console.error("Organise failed", err); } }
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
    `You write a short weekly letter to ${ctx.name || "a young Muslim"} who tracks his days in an app called Muhasaba: salah (40 pts), Qur'an memorisation (30), productive time (20: his business, learning the dīn, studies, skills) and walking (10), plus an evening check-in (sleep, phone use, energy, mood, a private "slipped" mark and whether he made tawbah).`,
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
  const target = letterTarget(endK, week, L.title || "");
  const doc = target.doc;
  const body = target.body;
  try { body.setMarginLeft(56).setMarginRight(56); } catch (e) { /* margins are per Doc */ }
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
  const t = body.appendTable([["", ctx.fr ? "Score" : "Score", "Salah", "Qur'an", ctx.fr ? "Productif" : "Productive", ctx.fr ? "Marche" : "Walk", ctx.fr ? "Sommeil" : "Sleep"]].concat(
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
  const url = target.url;

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
    ["Productive hours", `=SUM(${L("hours")})`, "0.#", C.violetSoft],
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

/* ================================================================== future me */

/**
 * Letters to your future self. The app sends the letter once, sealed; it waits in a hidden tab and the app can
 * never show it again. When its day comes (checked every hour, from 9:00), the script lays it out as a special
 * Google Doc in "Muhasaba Journal / Future me" and emails you that it's ready to read.
 */
const FUTURE = "_future";
const FCOLS = ["id", "written", "due", "text", "lang", "name", "hijri", "snap", "status", "docId", "deliveredAt"];
const FC = (k) => FCOLS.indexOf(k) + 1;
const FUTURE_MAX_DAYS = 3 * 366 + 1;

function futureSheet() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(FUTURE);
  if (!sh) {
    sh = ss.insertSheet(FUTURE);
    sh.getRange(1, 1, 1, FCOLS.length).setValues([FCOLS]).setFontWeight("bold");
    sh.getRange(1, 1, 1, 1).setNote("Sealed letters to your future self. Each one is delivered as a Google Doc on its day. Best not to read them here.");
    sh.hideSheet();
  }
  return sh;
}

function futureRows() {
  const sh = futureSheet();
  if (sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, FCOLS.length).getDisplayValues().map((v, i) => {
    const o = { row: i + 2 };
    FCOLS.forEach((k, j) => (o[k] = v[j]));
    return o;
  });
}

function daysBetween(a, b) {
  const x = keyParts(a), y = keyParts(b);
  return Math.round((Date.UTC(y.y, y.m - 1, y.d) - Date.UTC(x.y, x.m - 1, x.d)) / 864e5);
}
const wordCount = (t) => (String(t || "").trim() ? String(t).trim().split(/\s+/).length : 0);

/** App calls: seal a letter, cancel one, or list them (never with their text). */
function futureApi(body) {
  const sh = futureSheet();
  const today = Utilities.formatDate(new Date(), appCtx().tz, "yyyy-MM-dd");
  if (body.future) {
    const f = body.future;
    const id = String(f.id || "").replace(/[^\w-]/g, "").slice(0, 40);
    const text = String(f.text || "").slice(0, 45000);
    const due = String(f.due || "");
    if (!id || !text.trim()) throw new Error("The letter is empty.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due <= today || due > shiftKey(today, FUTURE_MAX_DAYS)) throw new Error("Pick a date between tomorrow and 3 years from now.");
    if (!futureRows().some((r) => r.id === id)) {
      const r = sh.getLastRow() + 1;
      const rng = sh.getRange(r, 1, 1, FCOLS.length);
      rng.setNumberFormat("@");
      rng.setValues([[id, String(f.written || today).slice(0, 10), due, text, f.lang === "fr" ? "fr" : "en", String(f.name || "").slice(0, 60),
        String(f.hijri || "").slice(0, 60), JSON.stringify(f.snap || {}).slice(0, 2000), "sealed", "", ""]]);
    }
  }
  if (body.futureCancel) {
    const r = futureRows().find((x) => x.id === String(body.futureCancel));
    if (r && r.status === "sealed") {
      sh.getRange(r.row, FC("text")).setValue("");
      sh.getRange(r.row, FC("status")).setValue("cancelled");
    }
  }
  return {
    future: futureRows().filter((r) => r.status === "sealed" || r.status === "delivered").map((r) => ({
      id: r.id, written: r.written, due: r.due, status: r.status, words: wordCount(r.text), url: r.docId ? docUrl(r.docId, "") : "",
    })),
  };
}

function futureFolder() {
  const parent = journalFolder();
  const it = parent.getFoldersByName("Future me");
  return it.hasNext() ? it.next() : parent.createFolder("Future me");
}

/** "6 months" / "1 year" / "1 an" … between two dates. */
function spanLabel(a, b, fr) {
  const x = keyParts(a), y = keyParts(b);
  let months = (y.y - x.y) * 12 + (y.m - x.m) - (y.d < x.d ? 1 : 0);
  const days = Math.round((Date.UTC(y.y, y.m - 1, y.d) - Date.UTC(x.y, x.m - 1, x.d)) / 864e5);
  if (months < 1) return fr ? `${days} jour${days > 1 ? "s" : ""}` : `${days} day${days > 1 ? "s" : ""}`;
  if (months % 12 === 0) { const n = months / 12; return fr ? `${n} an${n > 1 ? "s" : ""}` : `${n} year${n > 1 ? "s" : ""}`; }
  if (months > 12) { const n = Math.floor(months / 12), m = months % 12; return fr ? `${n} an${n > 1 ? "s" : ""} et ${m} mois` : `${n} year${n > 1 ? "s" : ""} and ${m} month${m > 1 ? "s" : ""}`; }
  return fr ? `${months} mois` : `${months} month${months > 1 ? "s" : ""}`;
}

/** Then-and-now numbers for the letter: average score over 30 days, Mushaf page, days logged since. */
function thenAndNow(r, today) {
  let snap = {};
  try { snap = JSON.parse(r.snap || "{}"); } catch (e) { snap = {}; }
  const days = readDays();
  const last30 = days.filter((d) => d.key > shiftKey(today, -30) && d.key <= today);
  const since = days.filter((d) => d.key > r.written && d.key <= today);
  const pagesSince = since.reduce((a, d) => a + (d.pages || 0), 0);
  return {
    avgThen: snap.avg30 != null ? Math.round(snap.avg30) : null,
    avgNow: last30.length ? Math.round(avgOf(last30.map((d) => d.score))) : null,
    pageThen: snap.page != null ? Number(snap.page) : null,
    pageNow: snap.page != null ? Number(snap.page) + pagesSince : null,
    pagesSince: pagesSince,
    loggedSince: since.length,
  };
}

/** The letter as a Google Doc: cream paper, a seal, the letter in large serif type, then-and-now, a duʿāʾ. */
function futureDoc(r, today) {
  const fr = r.lang === "fr";
  const T = (en, f) => (fr ? f : en);
  const span = spanLabel(r.written, today, fr);
  const doc = DocumentApp.create(`✉️ ${T("Letter from your past self", "Lettre de toi d'avant")} · ${longKey(r.written, fr)}`);
  DriveApp.getFileById(doc.getId()).moveTo(futureFolder());
  const body = doc.getBody();
  body.setMarginTop(64).setMarginBottom(64).setMarginLeft(72).setMarginRight(72);
  const A = DocumentApp.Attribute;
  const st = (o) => { const x = {}; Object.keys(o).forEach((k) => (x[A[k]] = o[k])); return x; };
  const CENTER = DocumentApp.HorizontalAlignment.CENTER;
  const INK = "#2A2840", MUTED = "#8A86A6", GOLD = "#B97A12";
  const line = (t, o) => body.appendParagraph(t).setAttributes(st(Object.assign({ FONT_FAMILY: "Roboto", FONT_SIZE: 10, BOLD: false, ITALIC: false, FOREGROUND_COLOR: MUTED }, o || {})));
  const dots = () => line("·   ·   ·", { FONT_SIZE: 14, FOREGROUND_COLOR: GOLD }).setAlignment(CENTER).setSpacingBefore(14).setSpacingAfter(14);

  const seal = body.getParagraphs()[0];
  seal.setText("✉").setAttributes(st({ FONT_SIZE: 34, FOREGROUND_COLOR: GOLD })).setAlignment(CENTER).setSpacingAfter(4);
  line(`${T("SEALED ON", "SCELLÉE LE")} ${longKey(r.written, fr).toUpperCase()}${r.hijri ? "  ·  " + r.hijri.toUpperCase() : ""}`, { FONT_SIZE: 8.5, BOLD: true, FOREGROUND_COLOR: GOLD })
    .setAlignment(CENTER).setSpacingAfter(10);
  const title = body.appendParagraph(T(`A letter from ${span} ago`, `Une lettre d'il y a ${span}`));
  title.setHeading(DocumentApp.ParagraphHeading.TITLE);
  title.setAttributes(st({ FONT_FAMILY: "Poppins", FONT_SIZE: 26, BOLD: true, ITALIC: false, FOREGROUND_COLOR: C.night })).setAlignment(CENTER).setSpacingAfter(4);
  line(T(`Written by ${r.name || "you"} on ${longKey(r.written, false)}. Opened on ${longKey(today, false)}.`,
    `Écrite par ${r.name || "toi"} le ${longKey(r.written, true)}. Ouverte le ${longKey(today, true)}.`), { ITALIC: true }).setAlignment(CENTER);
  dots();

  String(r.text || "").replace(/\r/g, "").split(/\n/).map((x) => x.trim()).filter(Boolean).forEach((t) => {
    body.appendParagraph(t).setAttributes(st({ FONT_FAMILY: "Lora", FONT_SIZE: 13, BOLD: false, ITALIC: false, FOREGROUND_COLOR: INK }))
      .setLineSpacing(1.6).setSpacingAfter(10);
  });
  dots();

  const n = thenAndNow(r, today);
  const rows = [];
  if (n.avgThen != null || n.avgNow != null) rows.push([T("Average score, last 30 days", "Score moyen, 30 derniers jours"), n.avgThen != null ? `${n.avgThen}/100` : "–", n.avgNow != null ? `${n.avgNow}/100` : "–"]);
  if (n.pageThen != null) rows.push([T("Page reached in the Mushaf", "Page atteinte dans le Mushaf"), String(n.pageThen), `${n.pageNow}${n.pagesSince ? `  (+${n.pagesSince})` : ""}`]);
  rows.push([T("Days logged since", "Jours notés depuis"), "", String(n.loggedSince)]);
  const h = body.appendParagraph(T("Then and now", "Avant et maintenant"));
  h.setHeading(DocumentApp.ParagraphHeading.HEADING2);
  h.setAttributes(st({ FONT_FAMILY: "Poppins", FONT_SIZE: 14, BOLD: true, ITALIC: false, FOREGROUND_COLOR: C.violet })).setSpacingAfter(6);
  const t = body.appendTable([["", T("Then", "Alors"), T("Now", "Maintenant")]].concat(rows));
  t.setBorderColor("#E8DFC9");
  t.setAttributes(st({ FONT_FAMILY: "Roboto", FONT_SIZE: 10.5, FOREGROUND_COLOR: INK }));
  const hr = t.getRow(0);
  for (let i = 0; i < hr.getNumCells(); i++) hr.getCell(i).setBackgroundColor("#F3EAD6").editAsText().setBold(true).setForegroundColor(GOLD);
  for (let i = 1; i < t.getNumRows(); i++) t.getRow(i).getCell(2).editAsText().setBold(true);

  body.appendParagraph("");
  line("يَا مُقَلِّبَ الْقُلُوبِ ثَبِّتْ قَلْبِي عَلَى دِينِكَ", { FONT_FAMILY: "Amiri", FONT_SIZE: 17, FOREGROUND_COLOR: C.night }).setAlignment(CENTER).setSpacingBefore(10);
  line(T("“O Turner of hearts, keep my heart firm upon Your religion.” (at-Tirmidhī)", "« Ô Toi qui retournes les cœurs, affermis mon cœur sur Ta religion. » (at-Tirmidhī)"), { ITALIC: true, FONT_SIZE: 10 })
    .setAlignment(CENTER).setSpacingAfter(18);
  line(T("Read it slowly. Then, from the Journal in Muhasaba, write the next one.", "Lis-la doucement. Puis, depuis le Journal de Muhasaba, écris la suivante."), { FONT_SIZE: 9 }).setAlignment(CENTER);
  doc.saveAndClose();
  if (hasDocsApi()) {
    try { docsBatch(doc.getId(), [{ updateDocumentStyle: { documentStyle: { background: { color: { color: { rgbColor: { red: 0.984, green: 0.965, blue: 0.925 } } } } }, fields: "background" } }]); }
    catch (e) { console.warn("Paper colour", e); }
  }
  return doc;
}

function futureMail(r, url, today, sample) {
  const fr = r.lang === "fr";
  const T = (en, f) => (fr ? f : en);
  const span = spanLabel(r.written, today, fr);
  const hi = r.name ? `As-salāmu ʿalaykum ${r.name},` : "As-salāmu ʿalaykum,";
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    name: "Muhasaba",
    subject: `${sample ? "[" + T("Sample", "Exemple") + "] " : ""}📬 ${T("A letter from your past self is ready", "Une lettre de toi d'avant est arrivée")}`,
    htmlBody: `<div style="font-family:Georgia,serif;font-size:16px;color:#1B1F4B;line-height:1.6;max-width:520px">
      <p style="font-size:34px;margin:0;color:#B97A12">✉</p>
      <p>${hi}</p>
      <p>${T(`${span} ago, on ${longKey(r.written, false)}, you sealed a letter and asked for it to reach you today. It's ready.`, `Il y a ${span}, le ${longKey(r.written, true)}, tu as scellé une lettre pour qu'elle t'arrive aujourd'hui. Elle est prête.`)}</p>
      <p><a href="${url}" style="display:inline-block;background:#1B1F4B;color:#fff;padding:12px 22px;border-radius:12px;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold">${T("Open the letter", "Ouvrir la lettre")}</a></p>
      <p style="color:#8A86A6;font-size:12px;font-family:Arial,sans-serif">${T("It's in your Drive, in Muhasaba Journal → Future me.", "Elle est dans ton Drive, dans Muhasaba Journal → Future me.")}</p></div>`,
  });
}

/** Hourly: deliver every sealed letter whose day has come (from 9:00 your time). */
function deliverFuture(force) {
  const ctx = appCtx();
  const now = new Date();
  const today = Utilities.formatDate(now, ctx.tz, "yyyy-MM-dd");
  if (!force && Number(Utilities.formatDate(now, ctx.tz, "H")) < 9) return 0;
  const sh = futureSheet();
  let n = 0;
  futureRows().filter((r) => r.status === "sealed" && r.due <= today).forEach((r) => {
    try {
      const doc = futureDoc(r, today);
      sh.getRange(r.row, FC("status")).setValue("delivered");
      sh.getRange(r.row, FC("docId")).setValue(doc.getId());
      sh.getRange(r.row, FC("deliveredAt")).setValue(today);
      n++;
      try { futureMail(r, doc.getUrl(), today, false); } catch (err) { console.error("Future letter email", err); }
    } catch (err) { console.error("Future letter", r.id, err); }
  });
  return n;
}

function futureStatusMenu() {
  const ctx = appCtx();
  const today = Utilities.formatDate(new Date(), ctx.tz, "yyyy-MM-dd");
  const rows = futureRows().filter((r) => r.status === "sealed").sort((a, b) => (a.due < b.due ? -1 : 1));
  const done = futureRows().filter((r) => r.status === "delivered").length;
  const list = rows.map((r) => {
    const d = daysBetween(today, r.due);
    return `✉  Sealed ${r.written} → opens ${longKey(r.due, false)} (in ${d} day${d === 1 ? "" : "s"})`;
  });
  SpreadsheetApp.getUi().alert("Future me", (list.length ? list.join("\n") : "No sealed letters yet. Write one from the Journal in the app.") + (done ? `\n\n${done} already delivered (Drive → Muhasaba Journal → Future me).` : ""), SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Shows what a delivered letter looks like (a sample text dated a year ago), and sends the email. */
function testFutureLetter() {
  const ctx = appCtx();
  const today = Utilities.formatDate(new Date(), ctx.tz, "yyyy-MM-dd");
  const fr = ctx.fr;
  const r = {
    written: shiftKey(today, -365), lang: fr ? "fr" : "en", name: ctx.name, hijri: "", snap: "{}",
    text: fr
      ? "Ceci est un exemple, pour voir à quoi ressemble une lettre le jour où elle arrive.\nTes vraies lettres s'écrivent depuis le Journal de l'app : écris-toi, scelle, et oublie-la jusqu'au jour J."
      : "This is a sample, so you can see what a letter looks like on the day it arrives.\nYour real letters are written from the Journal in the app: write to yourself, seal it, and forget about it until the day comes.",
  };
  const doc = futureDoc(r, today);
  futureMail(r, doc.getUrl(), today, true);
  SpreadsheetApp.getActive().toast("Sample letter created in Drive → Muhasaba Journal → Future me, and emailed to you.", "Muhasaba");
}
