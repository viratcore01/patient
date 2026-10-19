import oracledb from 'oracledb';

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
    let connection;
    try {
      connection = await oracledb.getConnection({
        connectString: process.env.DATABASE_URL,
      });
      try {
        const result = await connection.execute(
          'SELECT registration_number, body FROM notes'
        );
        const notes = {};
        for (const r of result.rows) notes[r.registration_number] = r.body;
        return res.status(200).json({ notes });
      } finally {
        if (connection) { try { await connection.close(); } catch (e) {} }
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
      let connection;
      try {
        connection = await oracledb.getConnection({
          connectString: process.env.DATABASE_URL,
        });
        try {
          const result = await connection.execute(
            'SELECT body FROM notes WHERE registration_number = ?',
            [reg]
          );
          return res.status(200).json({ notes: result.rows.length > 0 ? result.rows[0].body : '' });
        } finally {
          if (connection) { try { await connection.close(); } catch (e) {} }
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

      let connection;
      try {
        connection = await oracledb.getConnection({
          connectString: process.env.DATABASE_URL,
        });
        try {
          // Check patient exists
          const existsResult = await connection.execute(
            'SELECT 1 FROM patients WHERE id = ?',
            [reg]
          );
          if (existsResult.rows.length === 0) {
            return res.status(404).json({ error: 'Unknown patient' });
          }

          const value = String(body.notes || '').slice(0, 20000);
          await connection.execute(
            `INSERT INTO notes (registration_number, body, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)` +
            ` ON CONFLICT (registration_number) DO UPDATE SET body = excluded.body, updated_at = CURRENT_TIMESTAMP`,
            [reg, value]
          );

          return res.status(200).json({ ok: true });
        } catch (err) {
          console.error('[api/notes/put] error:', err);
          return res.status(500).json({ error: 'Database error' });
        } finally {
          if (connection) { try { await connection.close(); } catch (e) {} }
        }
      } catch (err) {
        console.error('[api/notes/put] connection error:', err);
        return res.status(500).json({ error: 'Database connection error' });
      } finally {
        if (connection) { try { await connection.close(); } catch (e) {} }
      }
    }

    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(404).json({ error: 'Not found' });
}