/**
 * Vitalis Patient Search — Cloudflare Worker
 * Static site + central patient API on D1, protected by Sign in with Freebuff.
 *
 * Data model:
 *   - patients table: the clinic's registry (seeded from data/patients.json).
 *     The doctor can read it and add patients.
 *   - notes table: one note entry per patient (single-doctor clinic).
 */
import { createFreebuffAuth, isSameOriginRequest } from '@freebuff/auth';

export default {
  async fetch(request, env) {
    const isLocal = env.APP_ORIGIN && env.APP_ORIGIN.indexOf('http://localhost') === 0;
    const auth = createFreebuffAuth({
      clientId: env.FREEBUFF_CLIENT_ID,
      issuer: env.FREEBUFF_ISSUER,
      baseUrl: env.APP_ORIGIN,
      allowInsecureLocalhost: isLocal,
    });

    const signedIn = auth.wrap(async (request, env) => {
      const url = new URL(request.url);

      // --- Session (for UI display only; server enforces access) ---------
      if (url.pathname === '/api/me') {
        const user = await auth.getUser(request);
        if (!user) return Response.json({ user: null }, { headers: { 'Cache-Control': 'private, no-store' } });
        return Response.json(
          { user: { name: user.name || null, email: user.email || null, sub: user.sub } },
          { headers: { 'Cache-Control': 'private, no-store' } }
        );
      }

      // --- Central patient registry --------------------------------------
      if (url.pathname === '/api/patients') {
        const user = await auth.getUser(request);
        if (!user) return Response.json({ error: 'Sign in required' }, { status: 401 });

        if (request.method === 'GET') {
          let { results } = await env.DB.prepare(
            'SELECT id, name, phone, age, gender, city, first_visit, seed_notes FROM patients ORDER BY id'
          ).all();

          // First-boot convenience: when the central registry is empty and no
          // one has added data yet, seed it from the bundled patient list so a
          // fresh clinic deployment starts with the starter records.
          if (results.length === 0) {
            const existingNotes = await env.DB.prepare('SELECT COUNT(*) AS n FROM notes').first('n');
            if (!existingNotes) {
              try {
                const asset = await env.ASSETS.fetch(new URL('/data/patients.json', url.origin));
                const seed = await asset.json();
                if (Array.isArray(seed)) {
                  for (const p of seed) {
                    if (!p || !p.id || !p.name) continue;
                    await env.DB.prepare(
                      'INSERT OR IGNORE INTO patients (id, name, phone, age, gender, city, first_visit, seed_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
                    ).bind(String(p.id), String(p.name), String(p.phone || ''),
                      p.age == null ? null : parseInt(p.age, 10),
                      p.gender ? String(p.gender) : null,
                      p.city ? String(p.city) : null,
                      p.firstVisit ? String(p.firstVisit) : null,
                      p.notes ? String(p.notes) : null).run();
                  }
                  ({ results } = await env.DB.prepare(
                    'SELECT id, name, phone, age, gender, city, first_visit, seed_notes FROM patients ORDER BY id'
                  ).all());
                }
              } catch (e) {
                // Seeding is best-effort; serve whatever the registry has.
              }
            }
          }
          return Response.json(
            {
              patients: results.map((p) => ({
                id: p.id,
                name: p.name,
                phone: p.phone,
                age: p.age,
                gender: p.gender,
                city: p.city,
                firstVisit: p.first_visit,
                notes: p.seed_notes || '',
              })),
            },
            { headers: { 'Cache-Control': 'private, no-store' } }
          );
        }

        if (request.method === 'POST') {
          if (!isSameOriginRequest(request, env.APP_ORIGIN)) return new Response(null, { status: 403 });
          let body;
          try {
            body = await request.json();
          } catch {
            return Response.json({ error: 'Invalid JSON' }, { status: 400 });
          }
          const name = String(body.name || '').trim();
          const phone = String(body.phone || '').replace(/[^\d+ ]/g, '').trim();
          if (!name) return Response.json({ error: 'Name is required' }, { status: 400 });

          const age = body.age === undefined || body.age === null || body.age === '' ? null : parseInt(body.age, 10);
          if (age !== null && (Number.isNaN(age) || age < 0 || age > 130)) {
            return Response.json({ error: 'Age must be between 0 and 130' }, { status: 400 });
          }

          // Generate the next registration number: HM-<year>-<seq>.
          const year = new Date().getFullYear();
          const prefix = `HM-${year}-`;
          const row = await env.DB.prepare(
            "SELECT id FROM patients WHERE id LIKE ? ORDER BY id DESC LIMIT 1"
          ).bind(prefix + '%').first();
          let seq = 1;
          if (row) {
            const last = parseInt(row.id.slice(prefix.length), 10);
            if (!Number.isNaN(last)) seq = last + 1;
          }
          const reg = `${prefix}${String(seq).padStart(4, '0')}`;

          await env.DB.prepare(
            'INSERT INTO patients (id, name, phone, age, gender, city, first_visit, seed_notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(
            reg,
            name,
            phone,
            age,
            String(body.gender || '').trim() || null,
            String(body.city || '').trim() || null,
            String(body.firstVisit || '').trim() ||
              new Date().toISOString().slice(0, 10),
            String(body.notes || '').trim() || null,
            user.sub
          ).run();

          return Response.json({ ok: true, registrationNumber: reg }, { status: 201 });
        }

        return Response.json({ error: 'Method not allowed' }, { status: 405 });
      }

      // --- Patient notes (single doctor: one note per patient) -----------
      if (url.pathname === '/api/notes' && request.method === 'GET') {
        const user = await auth.getUser(request);
        if (!user) return Response.json({ error: 'Sign in required' }, { status: 401 });
        const { results } = await env.DB.prepare(
          'SELECT registration_number, body FROM notes'
        ).all();
        const notes = {};
        for (const r of results) notes[r.registration_number] = r.body;
        return Response.json({ notes }, { headers: { 'Cache-Control': 'private, no-store' } });
      }

      let m;
      if ((m = url.pathname.match(/^\/api\/notes\/(.+)$/)) && request.method === 'GET') {
        const user = await auth.getUser(request);
        if (!user) return Response.json({ error: 'Sign in required' }, { status: 401 });
        const reg = decodeURIComponent(m[1]);
        const row = await env.DB.prepare(
          'SELECT body FROM notes WHERE registration_number = ?'
        ).bind(reg).first();
        return Response.json({ notes: row ? row.body : '' }, { headers: { 'Cache-Control': 'private, no-store' } });
      }

      if ((m = url.pathname.match(/^\/api\/notes\/(.+)$/)) && request.method === 'PUT') {
        if (!isSameOriginRequest(request, env.APP_ORIGIN)) return new Response(null, { status: 403 });
        const user = await auth.getUser(request);
        if (!user) return Response.json({ error: 'Sign in required' }, { status: 401 });
        const reg = decodeURIComponent(m[1]);
        let body;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: 'Invalid JSON' }, { status: 400 });
        }
        // Only allow notes on patients that exist in the registry.
        const exists = await env.DB.prepare('SELECT 1 AS x FROM patients WHERE id = ?').bind(reg).first();
        if (!exists) return Response.json({ error: 'Unknown patient' }, { status: 404 });

        await env.DB.prepare(
          "INSERT INTO notes (registration_number, owner, body, updated_at) VALUES (?, ?, ?, datetime('now')) " +
          "ON CONFLICT (registration_number, owner) DO UPDATE SET body = excluded.body, updated_at = datetime('now')"
        ).bind(reg, '_clinic_', String(body.notes ?? '').slice(0, 20000)).run();

        return Response.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
      }

      // --- Seed (only when the registry is empty; used on first deploy) ----
      if (url.pathname === '/api/seed' && request.method === 'POST') {
        const user = await auth.getUser(request);
        if (!user) return Response.json({ error: 'Sign in required' }, { status: 401 });
        if (!isSameOriginRequest(request, env.APP_ORIGIN)) return new Response(null, { status: 403 });
        const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM patients').first('n');
        if (count > 0) return Response.json({ ok: true, seeded: false, existing: count });
        let body;
        try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
        const list = Array.isArray(body.patients) ? body.patients : [];
        let inserted = 0;
        for (const p of list) {
          if (!p || !p.id || !p.name) continue;
          await env.DB.prepare(
            'INSERT OR IGNORE INTO patients (id, name, phone, age, gender, city, first_visit, seed_notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(String(p.id), String(p.name), String(p.phone || ''),
                 p.age == null ? null : parseInt(p.age, 10),
                 p.gender ? String(p.gender) : null,
                 p.city ? String(p.city) : null,
                 p.firstVisit ? String(p.firstVisit) : null,
                 p.notes ? String(p.notes) : null).run();
          inserted++;
        }
        return Response.json({ ok: true, seeded: true, inserted });
      }

      // --- Health ---------------------------------------------------------
      if (url.pathname === '/api/health') return Response.json({ ok: true });

      return env.ASSETS.fetch(request);
    });

    return signedIn(request, env);
  },
};
