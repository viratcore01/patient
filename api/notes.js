export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // CORS preflight
  if (req.method === 'OPTIONS' && req.url.startsWith('/api/')) {
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    return res.end();
  }

  // GET /api/health - always works
  if (req.url === '/api/health' || req.url === '/api/health/') {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // GET /api/notes - return embedded notes data
  if (req.url === '/api/notes') {
    try {
      const fs = require('fs');
      const path = require('path');
      const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'patients.json'), 'utf8'));
      const notes = {};
      data.forEach(p => { if (p.notes) notes[p.id] = p.notes; });
      res.statusCode = 200;
      res.end(JSON.stringify({ notes }));
      return;
    } catch (e) {
      res.statusCode = 200;
      res.end(JSON.stringify({ notes: {} }));
      return;
    }
  }

  // GET/PUT /api/notes/:reg
  const m = req.url.match(/^\/api\/notes\/(.+)$/);
  if (m) {
    const reg = decodeURIComponent(m[1]);

    // GET /api/notes/:reg
    if (req.method === 'GET') {
      try {
        const fs = require('fs');
        const path = require('path');
        const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'patients.json'), 'utf8'));
        const patient = data.find(p => p.id === reg);
        if (!patient) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Unknown patient' }));
          return;
        }
        res.statusCode = 200;
        res.end(JSON.stringify({ notes: patient.notes || '' }));
        return;
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Server error' }));
        return;
      }
    }

    // PUT /api/notes/:reg
    if (req.method === 'PUT') {
      try {
        const fs = require('fs');
        const path = require('path');
        const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'patients.json'), 'utf8'));
        const patient = data.find(p => p.id === reg);
        if (!patient) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Unknown patient' }));
          return;
        }
        const body = JSON.parse(req.body || '{}');
        if (body.notes !== undefined) patient.notes = body.notes;
        
      // Rewrite file with updated data
      try {
        fs.writeFileSync(path.join(process.cwd(), 'data', 'patients.json'), JSON.stringify(data, null, 2));
      } catch (e) { /* ignore write errors */ }

      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
      return;
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Server error' }));
      return;
    }
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}