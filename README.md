# Muhasaba

Mohamed's daily accountability app. It scores each day out of 100 across Salah (40), Qur'an (30), MuslimPreneur (20) and the daily walk (10).

Built with Next.js 15, React 19, TypeScript and Framer Motion. Data is stored on the phone (localStorage), and the app works offline once installed.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # static site in /out
```

## Deploy

- **Vercel:** import the project, with no settings needed.
- **Netlify:** build command `npm run build`, publish directory `out`. Or drag the `out` folder onto app.netlify.com/drop.

To install it on Android, open the site in Chrome and tap ⋮ → Install app.

## Google Sheet sync

`google-sheet/Code.gs` is a Google Apps Script that turns a Google Sheet into Muhasaba's history log: one row per day, a Dashboard tab with totals and charts.

1. Create a Google Sheet, then Extensions → Apps Script. Paste `Code.gs` and save.
2. Run `setup` once and allow access.
3. Deploy → New deployment → Web app. Execute as: Me. Who has access: Anyone. Copy the URL.
4. In the app: Record → Google Sheet → paste the URL → Connect.

The app sends changes about 3 seconds after you tap. Offline changes wait and send when you're back online. Sync is one-way, app to sheet.

## Where things live

| Path | What it holds |
| --- | --- |
| `lib/constants.ts` | Name, birthday, prayers, work topics, starting page |
| `lib/scoring.ts` | Point rules, Qur'an page maths |
| `lib/store.tsx` | State, saving, celebrations |
| `components/` | One file per card, plus the hero and the Record tab |
| `lib/sheetSync.ts` | Row format and sending to the sheet |
| `google-sheet/Code.gs` | The script that writes the sheet |
| `app/globals.css` | Fajr (light) and Isha (dark) colour tokens |
