# Patient Search — Vitalis Homeopathy

A fast, responsive web app for a homeopathic clinic: search patients by **name**, **phone number**, or **registration number** and open each patient's file to view or record extra clinical information.

## Features

- **Instant shortlisting as you type** — powered by [MiniSearch](https://github.com/lucaong/minisearch), a production-grade in-memory search engine used widely for client-side full-text/fuzzy search with prefix matching and field boosting.
- **Works with any input** — typos (fuzzy), partial names, partial phone numbers, garbled or accented characters all shortlist the best possible matches, with keyboard navigation (↑/↓/Enter/Esc).
- **Match highlighting** — the matched part of the name, phone and registration number is highlighted.
- **Patient file drawer** — click a result to see the full record: registration number (main identifier), name, phone (tap to call), age, gender, city, first visit.
- **Clinical notes** — anything the doctor wants recorded can be typed and saved per patient; saved notes persist across sessions via `localStorage` and show a green dot in search results.
- **Green & white UI** — clean clinical theme, mobile-first layout with a bottom-sheet drawer on phones, PWA manifest for installable use.

## Run it

Any static server works — no build step required:

```bash
npm install
npm start          # serves on http://localhost:3000
```

Or simply open `index.html` directly in a browser.

## Data

Patient records live in [`data/patients.json`](data/patients.json). Edit this file to add or update registered patients (id/name/phone/age/gender/city/firstVisit/notes). Doctor-entered extra notes are stored per device in the browser's `localStorage` (key `vitalis_notes_v1`).

## Central sync (multi-device)

The app is also a full-stack Cloudflare Workers + D1 deployment with Sign in with Freebuff: each doctor signs in with their own account, sees the shared patient registry, and their clinical notes sync to every clinic device. Doctor-added notes are private to that doctor's account (stored per account in the `notes` table); the patient registry is shared.

- `worker.js` — Worker API: `/api/patients` (GET/POST), `/api/notes` (GET), `/api/notes/:reg` (GET/PUT), auth-wrapped, D1-backed
- `schema.sql` — D1 schema (patients + notes tables)
- `scripts/make-seed.js` — generates `seed.sql` from `data/patients.json`
- `build.sh` — bundles the worker and mirrors assets to `public/` for deployment

The fully static version (no backend) still works on its own: `app.js` falls back to the bundled `data/patients.json` and localStorage when the API is not present.

## Self-hosted Oracle VM backend (current production)

The app in daily use runs on an Oracle Cloud free-tier VM as a plain Node.js server with built-in SQLite (no dependencies):

- **URL:** https://patient.129.154.239.74.sslip.io (HTTPS via Caddy + sslip.io wildcard DNS)
- **`server.js`** — same API shape as the Worker: `/api/health`, `/api/patients` (GET/POST), `/api/notes` (GET), `/api/notes/:reg` (GET/PUT). Serves `public/` statically; database in SQLite at `data/patients.db`; writes require the `x-vitalis-client: app` header (a light CSRF gate for the single-user, no-login setup). Seeds the 30 starter records automatically on first run.
- Runs as the `vitalis.service` systemd unit on port 3005 (auto-starts on boot); Caddy reverse-proxies the HTTPS subdomain to it. The clinic's other site on the same VM is untouched.

### Static mirror (Vercel)

A static-only mirror lives at https://patient-beta-lake.vercel.app. On hosts without a backend, the frontend automatically falls back to the central Oracle VM API (configured in `config.js` → `window.VITALIS_API_BASE`), so search, registration and notes behave identically there — same central SQLite data. The VM allows these cross-origin API calls only for origins on its allow-list (`VITALIS_ALLOWED_ORIGINS`, default: the Vercel domain + localhost dev ports).

Redeploy the mirror after changes: `vercel --prod` from this directory (or dashboard redeploy).

Redeploy updates:

```bash
./build.sh
scp -i <key> public/app.js ubuntu@129.154.239.74:apps/vitalis/public/app.js   # static files are read per request — no restart needed
# for server.js changes: scp + `sudo systemctl restart vitalis`
```

## Deploy

The site is deployed on Freebuff Sites (Cloudflare Workers + D1 + Sign in with Freebuff). To run locally:

```bash
npm install
./build.sh
npx wrangler d1 execute local-db --local --file=seed.sql   # seed local D1
npx wrangler dev --port 8787                                # http://localhost:8787
```

Or serve only the static version: `npm start` → http://localhost:3000
