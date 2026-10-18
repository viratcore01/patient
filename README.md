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

## Deploy

This is a fully static site — GitHub Pages, Netlify, Vercel or any CDN can host it as-is.
