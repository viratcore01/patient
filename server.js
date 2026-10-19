/**
 * Vitalis Patient Search — VM backend (single-doctor clinic).
 * Plain Node http server + built-in SQLite (node:sqlite). No dependencies.
 * Serves the static app from ./public and the patient API.
 *
 * Endpoints (same shapes as the Cloudflare Worker version):
 *   GET  /api/health
 *   GET  /api/patients      -> { patients: [...] }   (auto-seeds on first call)
 *   POST /api/patients      -> { ok, registrationNumber }
 *   GET  /api/notes         -> { notes: { reg: body } }
 *   GET  /api/notes/:reg    -> { notes }
 *   PUT  /api/notes/:reg    -> { ok }
 *
 * State-changing requests must carry header "X-Vitalis-Client: app"
 * (same-site enforcement without cookies, since the app is behind one origin).
 */
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = parseInt(process.env.PORT || '3005', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'patients.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS patients (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL DEFAULT '',
  age           INTEGER,
  gender        TEXT,
  city          TEXT,
  first_visit   TEXT,
  seed_notes    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS notes (
  registration_number TEXT PRIMARY KEY,
  body                TEXT NOT NULL DEFAULT '',
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function httpError(res, code, message) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: message }));
}

function digitsOnly(s) {
  return String(s || '').replace(/\D+/g, '');
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/* Auto-seed central registry from bundled patients.json on first run. */
function seedIfEmpty() {
  const n = db.prepare('SELECT COUNT(*) AS n FROM patients').get().n;
  if (n > 0) return;
  // The patient list ships in the static bundle; prefer data/, fall back to public/data/.
  const candidates = [
    path.join(DATA_DIR, 'patients.json'),
    path.join(PUBLIC_DIR, 'data', 'patients.json'),
  ];
  try {
    const file = candidates.find((c) => fs.existsSync(c));
    if (!file) {
      console.error('[seed] patients.json not found in', candidates.join(' or '));
      return;
    }
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ins = db.prepare(
      'INSERT OR IGNORE INTO patients (id, name, phone, age, gender, city, first_visit, seed_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    let added = 0;
    for (const p of list) {
      if (!p || !p.id || !p.name) continue;
      ins.run(String(p.id), String(p.name), String(p.phone || ''),
        p.age == null ? null : parseInt(p.age, 10),
        p.gender ? String(p.gender) : null,
        p.city ? String(p.city) : null,
        p.firstVisit ? String(p.firstVisit) : null,
        p.notes ? String(p.notes) : null);
      if (p.notes) {
        db.prepare('INSERT OR IGNORE INTO notes (registration_number, body) VALUES (?, ?)')
          .run(String(p.id), String(p.notes));
      }
      added++;
    }
    console.log(`[seed] inserted ${added} starter patients`);
  } catch (e) {
    console.error('[seed] failed:', e.message);
  }
}

let seeded = false;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  try {
    /* ---------------- API ---------------- */
    if (p === '/api/health') {
      return sendJSON(res, 200, { ok: true });
    }

    if (p === '/api/patients') {
      if (!seeded) { seedIfEmpty(); seeded = true; }

      if (req.method === 'GET') {
        const rows = db.prepare('SELECT * FROM patients ORDER BY id').all();
        return sendJSON(res, 200, {
          patients: rows.map((r) => ({
            id: r.id, name: r.name, phone: r.phone, age: r.age,
            gender: r.gender, city: r.city,
            firstVisit: r.first_visit, notes: r.seed_notes || '',
          })),
        });
      }

      if (req.method === 'POST') {
        if (req.headers['x-vitalis-client'] !== 'app') return httpError(res, 403, 'Forbidden');
        let body;
        try { body = JSON.parse(await readBody(req, 20000)); } catch { return httpError(res, 400, 'Invalid JSON'); }
        const name = String(body.name || '').trim();
        const phone = String(body.phone || '').replace(/[^\d+ ]/g, '').trim();
        if (!name) return httpError(res, 400, 'Name is required');
        const age = body.age === undefined || body.age === null || body.age === '' ? null : parseInt(body.age, 10);
        if (age !== null && (Number.isNaN(age) || age < 0 || age > 130)) {
          return httpError(res, 400, 'Age must be between 0 and 130');
        }

        const year = new Date().getFullYear();
        const prefix = `HM-${year}-`;
        const last = db.prepare("SELECT id FROM patients WHERE id LIKE ? ORDER BY id DESC LIMIT 1").get(prefix + '%');
        let seq = 1;
        if (last) {
          const n = parseInt(last.id.slice(prefix.length), 10);
          if (!Number.isNaN(n)) seq = n + 1;
        }
        const reg = `${prefix}${String(seq).padStart(4, '0')}`;

        db.prepare('INSERT INTO patients (id, name, phone, age, gender, city, first_visit) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(reg, name, phone, age,
            String(body.gender || '').trim() || null,
            String(body.city || '').trim() || null,
            String(body.firstVisit || '').trim() || new Date().toISOString().slice(0, 10));

        return sendJSON(res, 201, { ok: true, registrationNumber: reg });
      }

      return httpError(res, 405, 'Method not allowed');
    }

    let m;
    if ((m = p.match(/^\/api\/notes$/)) && req.method === 'GET') {
      const rows = db.prepare('SELECT registration_number, body FROM notes').all();
      const notes = {};
      for (const r of rows) notes[r.registration_number] = r.body;
      return sendJSON(res, 200, { notes });
    }

    if ((m = p.match(/^\/api\/notes\/(.+)$/))) {
      const reg = decodeURIComponent(m[1]);
      const exists = db.prepare('SELECT 1 AS x FROM patients WHERE id = ?').get(reg);
      if (!exists) return httpError(res, 404, 'Unknown patient');

      if (req.method === 'GET') {
        const row = db.prepare('SELECT body FROM notes WHERE registration_number = ?').get(reg);
        return sendJSON(res, 200, { notes: row ? row.body : '' });
      }

      if (req.method === 'PUT') {
        if (req.headers['x-vitalis-client'] !== 'app') return httpError(res, 403, 'Forbidden');
        let body;
        try { body = JSON.parse(await readBody(req, 25000)); } catch { return httpError(res, 400, 'Invalid JSON'); }
        const value = String(body.notes ?? '').slice(0, 20000);
        db.prepare(
          `INSERT INTO notes (registration_number, body, updated_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT (registration_number) DO UPDATE SET body = excluded.body, updated_at = datetime('now')`
        ).run(reg, value);
        return sendJSON(res, 200, { ok: true });
      }

      return httpError(res, 405, 'Method not allowed');
    }

    if (p.startsWith('/api/')) return httpError(res, 404, 'Not found');

    /* ---------------- Static files ---------------- */
    let filePath = decodeURIComponent(p);
    if (filePath === '/' || filePath === '') filePath = '/index.html';
    const abs = path.normalize(path.join(PUBLIC_DIR, filePath));
    if (!abs.startsWith(PUBLIC_DIR)) return httpError(res, 403, 'Forbidden');
    fs.readFile(abs, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not found');
      }
      const ext = path.extname(abs).toLowerCase();
      const types = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.json': 'application/json',
        '.webmanifest': 'application/manifest+json',
        '.woff2': 'font/woff2',
      };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    console.error('[server]', e);
    if (!res.headersSent) httpError(res, 500, 'Server error');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Vitalis patient API listening on 127.0.0.1:${PORT}`);
  seedIfEmpty();
  seeded = true;
});
