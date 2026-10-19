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
      let connection;
      try {
        connection = await oracledb.getConnection({
          connectString: process.env.DATABASE_URL,
          // For Oracle Free Tier TCPS, you may need wallet settings
          // walletLocation: process.env.ORACLE_WALLET_PATH,
          // sqlnetTimeout: 60
        });
        try {
          const result = await connection.execute(
            'SELECT id, name, phone, age, gender, city, first_visit FROM patients ORDER BY id'
          );
          const rows = result.rows;
          return res.status(200).json({ patients: rows });
        } finally {
          if (connection) { try { await connection.close(); } catch (e) {} }
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

      let connection;
      try {
        connection = await oracledb.getConnection({
          connectString: process.env.DATABASE_URL,
        });
        try {
          const lastResult = await connection.execute(
            "SELECT id FROM patients WHERE id LIKE ? ORDER BY id DESC LIMIT 1",
            [prefix + '%']
          );
          let seq = 1;
          if (lastResult.rows.length > 0) {
            const n = parseInt(lastResult.rows[0].id.slice(prefix.length), 10);
            if (!isNaN(n)) seq = n + 1;
          }
          const reg = `${prefix}${String(seq).padStart(4, '0')}`;

          await connection.execute(
            'INSERT INTO patients (id, name, phone, age, gender, city, first_visit) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [reg, name, phone, body.age === undefined || body.age === null ? null : parseInt(body.age, 10),
             String(body.gender || '').trim() || null,
             String(body.city || '').trim() || null,
             String(body.firstVisit || '').trim() || new Date().toISOString().slice(0, 10)]
          );

          // Insert empty notes entry
          await connection.execute(
            `INSERT INTO notes (registration_number, body, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
            [reg, '']
          );

          return res.status(201).json({ ok: true, registrationNumber: reg });
        } catch (err) {
          console.error('[api/patients] insert error:', err);
          return res.status(500).json({ error: 'Database error' });
        } finally {
          if (connection) { try { await connection.close(); } catch (e) {} }
        }
      } catch (err) {
        console.error('[api/patients] connection error:', err);
        return res.status(500).json({ error: 'Database connection error' });
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
    let connection;
    try {
      connection = await oracledb.getConnection({
        connectString: process.env.DATABASE_URL,
      });
      // Check patient exists
      const existsResult = await connection.execute(
        'SELECT 1 FROM patients WHERE id = ?',
        [reg]
      );
      if (existsResult.rows.length === 0) {
        return res.status(404).json({ error: 'Unknown patient' });
      }

      const name = String(body.name || '').trim();
      if (!name) {
        return res.status(400).json({ error: 'Name is required' });
      }
      if (name.length > 80) {
        return res.status(400).json({ error: 'Name too long' });
      }

      const phone = String(body.phone || '').replace(/[^\d+ ]/g, '').trim().slice(0, 20);
      const gender = String(body.gender || '').trim().slice(0, 30) || null;
      const city = String(body.city || '').trim().slice(0, 60) || null;
      const visit = String(body.firstVisit || '').trim();
      if (visit && !/^\d{4}-\d{2}-\d{2}$/.test(visit)) {
        return res.status(400).json({ error: 'First visit must be YYYY-MM-DD' });
      }

      let age = body.age === undefined || body.age === null || body.age === '' ? null : parseInt(body.age, 10);
      if (age !== null && (isNaN(age) || age < 0 || age > 130)) {
        return res.status(400).json({ error: 'Age must be between 0 and 130' });
      }

      try {
        await connection.execute(
          'UPDATE patients SET name = ?, phone = ?, age = ?, gender = ?, city = ?, first_visit = ? WHERE id = ?',
          [name, phone, age, gender, city, visit || null, reg]
        );

        const rowResult = await connection.execute('SELECT * FROM patients WHERE id = ?', [reg]);
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
        if (connection) { try { await connection.close(); } catch (e) {} }
      }
    } catch (err) {
      console.error('[api/patients] connection error:', err);
      return res.status(500).json({ error: 'Database connection error' });
    } finally {
      if (connection) { try { await connection.close(); } catch (e) {} }
    }
  }

  return res.status(404).json({ error: 'Not found' });
}