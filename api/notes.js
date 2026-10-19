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

  // GET /api/notes
  if (p === '/api/notes') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    try {
      const client = await pool.connect();
      try {
        const { rows } = await client.query('SELECT registration_number, body FROM notes');
        const notes = {};
        for (const r of rows) notes[r.registration_number] = r.body;
        return res.status(200).json({ notes });
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('[api/notes] error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
  }

  // GET/PUT /api/notes/:reg
  const m = p.match(/^\/api\/notes\/(.+)$/);
  if (m) {
    const reg = decodeURIComponent(m[1]);
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method === 'GET') {
      try {
        const client = await pool.connect();
        try {
          const row = await client.query(
            'SELECT body FROM notes WHERE registration_number = ?',
            [reg]
          );
          return res.status(200).json({ notes: row.rows.length > 0 ? row.rows[0].body : '' });
        } finally {
          client.release();
        }
      } catch (err) {
        console.error('[api/notes/get] error:', err);
        return res.status(500).json({ error: 'Database error' });
      }
    }

    if (req.method === 'PUT') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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

      const client = await pool.connect();
      try {
        const exists = await client.query(
          'SELECT 1 FROM patients WHERE id = ?',
          [reg]
        );
        if (exists.rows.length === 0) {
          client.release();
          return res.status(404).json({ error: 'Unknown patient' });
        }

        const value = String(body.notes || '').slice(0, 20000);
        await client.query(
          `INSERT INTO notes (registration_number, body, updated_at) VALUES (?, ?, datetime('now'))
           ON CONFLICT (registration_number) DO UPDATE SET body = excluded.body, updated_at = datetime('now')`,
          [reg, value]
        );

        return res.status(200).json({ ok: true });
      } catch (err) {
        console.error('[api/notes/put] error:', err);
        return res.status(500).json({ error: 'Database error' });
      } finally {
        client.release();
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(404).json({ error: 'Not found' });
}