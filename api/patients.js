import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  idleTimeoutMillis: 5000,
});

export default async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS' && p.startsWith('/api/')) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    return res.end();
  }

  // GET /api/health
  if (p === '/api/health') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).json({ ok: true });
  }

  // GET/POST /api/patients
  if (p === '/api/patients') {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      return res.end();
    }

    if (req.method === 'GET') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      try {
        const client = await pool.connect();
        try {
          const { rows } = await client.query('SELECT id, name, phone, age, gender, city, first_visit FROM patients ORDER BY id');
          return res.status(200).json({ patients: rows });
        } finally {
          client.release();
        }
      } catch (err) {
        console.error('[api/patients] query error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
    }

    if (req.method === 'POST') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-vitalis-client');

      // Validate x-vitalis-client header
      if (req.headers['x-vitalis-client'] !== 'app') {
        return res.status(403).json({ error: 'Forbidden' });
      }

      let body;
      try {
        body = JSON.parse(await new Promise((resolve, reject) => {
          let data = '';
          req.on('data', chunk => { data += chunk; });
          req.on('end', () => resolve(data));
          req.on('error', reject);
        }));
      } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON' });
      }

      const name = String(body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'Name is required' });

      const phone = String(body.phone || '').replace(/[^\d+ ]/g, '').trim();

      // Generate registration number: HM-YYYY-XXXX
      const year = new Date().getFullYear();
      const prefix = `HM-${year}-`;

      const client = await pool.connect();
      try {
        const last = await client.query(
          "SELECT id FROM patients WHERE id LIKE ? ORDER BY id DESC LIMIT 1",
          [prefix + '%']
        );
        let seq = 1;
        if (last.rows.length > 0) {
          const n = parseInt(last.rows[0].id.slice(prefix.length), 10);
          if (!isNaN(n)) seq = n + 1;
        }
        const reg = `${prefix}${String(seq).padStart(4, '0')}`;

        const result = await client.query(
          'INSERT INTO patients (id, name, phone, age, gender, city, first_visit) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [reg, name, phone, body.age === undefined || body.age === null ? null : parseInt(body.age, 10),
           String(body.gender || '').trim() || null,
           String(body.city || '').trim() || null,
           String(body.firstVisit || '').trim() || new Date().toISOString().slice(0, 10)]
        );

        // Also insert empty notes entry
        await client.query(
          `INSERT INTO notes (registration_number, body, updated_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT (registration_number) DO UPDATE SET body = excluded.body, updated_at = datetime('now')`,
          [reg, '']
        );

        return res.status(201).json({ ok: true, registrationNumber: reg });
      } catch (err) {
        console.error('[api/patients] insert error:', err);
        return res.status(500).json({ error: 'Database error' });
      } finally {
        client.release();
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }

  // PUT /api/patients/:reg
  const pm = p.match(/^\/api\/patients\/(.+)$/);
  if (pm && req.method === 'PUT') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-vitalis-client');

    if (req.headers['x-vitalis-client'] !== 'app') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    let body;
    try {
      body = JSON.parse(await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => { data += chunk; });
        req.on('end', () => resolve(data));
        req.on('error', reject);
      }));
    } catch (e) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const reg = decodeURIComponent(pm[1]);
    const client = await pool.connect();
    // Check patient exists
    const exists = await client.query(
      'SELECT 1 FROM patients WHERE id = ?',
      [reg]
    );
    if (exists.rows.length === 0) {
      client.release();
      return res.status(404).json({ error: 'Unknown patient' });
    }

    const name = String(body.name || '').trim();
    if (!name) {
      client.release();
      return res.status(400).json({ error: 'Name is required' });
    }
    if (name.length > 80) {
      client.release();
      return res.status(400).json({ error: 'Name too long' });
    }

    const phone = String(body.phone || '').replace(/[^\d+ ]/g, '').trim().slice(0, 20);
    const gender = String(body.gender || '').trim().slice(0, 30) || null;
    const city = String(body.city || '').trim().slice(0, 60) || null;
    const visit = String(body.firstVisit || '').trim();
    if (visit && !/^\d{4}-\d{2}-\d{2}$/.test(visit)) {
      client.release();
      return res.status(400).json({ error: 'First visit must be YYYY-MM-DD' });
    }

    let age = body.age === undefined || body.age === null || body.age === '' ? null : parseInt(body.age, 10);
    if (age !== null && (isNaN(age) || age < 0 || age > 130)) {
      client.release();
      return res.status(400).json({ error: 'Age must be between 0 and 130' });
    }

    try {
      await client.query(
        'UPDATE patients SET name = ?, phone = ?, age = ?, gender = ?, city = ?, first_visit = ? WHERE id = ?',
        [name, phone, age, gender, city, visit || null, reg]
      );

      const rowResult = await client.query('SELECT * FROM patients WHERE id = ?', [reg]);
      return res.status(200).json({
        ok: true,
        patient: {
          id: rowResult.rows[0].id,
          name: rowResult.rows[0].name,
          phone: rowResult.rows[0].phone,
          age: rowResult.rows[0].age,
          gender: rowResult.rows[0].gender,
          city: rowResult.rows[0].city,
          firstVisit: rowResult.rows[0].first_visit,
        }
      });
    } catch (err) {
      console.error('[api/patients] update error:', err);
      return res.status(500).json({ error: 'Database error' });
    } finally {
      client.release();
    }
  }

  return res.status(404).json({ error: 'Not found' });
}