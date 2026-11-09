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
  ["Pages memorised", "pages", 84],
  ["Portion", "portion", 82],
  ["Minutes", "minutes", 70],
  ["Difficulty", "difficulty", 84],
  ["Preview", "preview", 66],
  ["1 juz", "juz", 56],
  ["Mulk (Subh)", "mulkSubh", 84],
  ["Mulk (Maghrib)", "mulkMaghrib", 100],
  ["Hours", "hours", 60],
  ["Topics", "topics", 200],
  ["What moved forward", "note", 280],
  ["Steps", "steps", 76],
  ["Bonus ✦", "bonus", 70],
  ["Bonus deeds", "bonusList", 220],
  ["Journal", "journal", 96],
  ["The day in a line", "summary", 300],
  ["Last update", "updated", 140],
];
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

const PRAYER_LABELS = ["Before takbīr", "Mosque (late)", "No mosque"];
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
      return json({ ok: true, app: "muhasaba", sheet: SpreadsheetApp.getActive().getName(), days: lastDataRow(sheet) - 1, ai: aiProvider() || "none" });
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
    reply = { ok: true, saved };
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
  const provider = aiProvider();
  if (!provider) return null;
  const prompt = buildPrompt(entries, shukr, meta);
  const p = PropertiesService.getScriptProperties();
  if (provider === "claude") {
    const res = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages", {
      method: "post", contentType: "application/json", muteHttpExceptions: true,
      headers: { "x-api-key": p.getProperty("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" },
      payload: JSON.stringify({ model: p.getProperty("CLAUDE_MODEL") || "claude-haiku-5-5", max_tokens: 16000, messages: [{ role: "user", content: prompt }] }),
    });
    if (res.getResponseCode() !== 200) throw new Error("Claude " + res.getResponseCode() + ": " + res.getContentText().slice(0, 300));
    const j = JSON.parse(res.getContentText());
    return parseJson((j.content || []).map((c) => c.text || "").join(""));
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
  return parseJson(parts.map((x) => x.text || "").join(""));
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
  // Columns changed since an older version: clear old rows. The app keeps everything and sends it again.
  if (!fresh && !headerOk) {
    const f = sh.getFilter(); if (f) f.remove();
    sh.getRange(2, 1, sh.getMaxRows() - 1, sh.getMaxColumns()).clearContent().clearDataValidations();
    sh.getRange(1, 1, 1, sh.getMaxColumns()).clearContent();
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
    ["Prayers in the mosque", `=IFERROR((COUNTIF(${prayers},"Before takbīr")+COUNTIF(${prayers},"Mosque (late)"))/COUNTA(${prayers}),"–")`, "0%", C.violetSoft],
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
