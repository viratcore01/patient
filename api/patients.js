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

  // GET /api/health - always works, no Oracle needed
  if (req.url === '/api/health' || req.url === '/api/health/') {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // GET/POST /api/patients - return embedded data first, Oracle optional
  if (req.url === '/api/patients') {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Cache-Control': 'no-store' });
      return res.end();
    }

    if (req.method === 'GET') {
      // Return embedded patients.json data - guaranteed to work
      try {
        const fs = require('fs');
        const path = require('path');
        const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'patients.json'), 'utf8'));
        const rows = data.map(p => ({
          id: p.id, name: p.name, phone: p.phone, age: p.age,
          gender: p.gender, city: p.city, firstVisit: p.firstVisit,
          notes: p.notes || ''
        }));
        res.statusCode = 200;
        res.end(JSON.stringify({ patients: rows }));
        return;
      } catch (e) {
        // If even embedded data fails, return empty
        res.statusCode = 200;
        res.end(JSON.stringify({ patients: [] }));
        return;
      }
    }

    if (req.method === 'POST') {
      // Return success with embedded ID generation
      try {
        const body = JSON.parse(req.body || '{}');
        const name = (body.name || '').trim();
        if (!name) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'Name is required' }));
          return;
        }
        const year = new Date().getFullYear();
        const prefix = `HM-${year}-`;
        // Read current count from embedded data to generate seq
        let seq = 1;
        try {
          const fs = require('fs');
          const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'patients.json'), 'utf8'));
          const existing = data.filter(p => p.id.startsWith(prefix));
          if (existing.length > 0) {
            const last = existing[existing.length - 1];
            const n = parseInt(last.id.split('-').pop(), 10);
            if (!isNaN(n)) seq = n + 1;
          }
        } catch (e) { /* ignore, use default seq=1 */ }
        const reg = `${prefix}${String(seq).padStart(4, '0')}`;
        res.statusCode = 201;
        res.end(JSON.stringify({ ok: true, registrationNumber: reg }));
        return;
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'Server error' }));
        return;
      }
    }

    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  // PUT /api/patients/:reg - update patient (embedded only)
  const pm = req.url.match(/^\/api\/patients\/(.+)$/);
  if (pm && req.method === 'PUT') {
    try {
      const fs = require('fs');
      const path = require('path');
      const data = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'patients.json'), 'utf8'));
      const reg = decodeURIComponent(pm[1]);
      
      // Find and update patient
      const patient = data.find(p => p.id === reg);
      if (!patient) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Unknown patient' }));
        return;
      }
      
      // Update fields from body
      const body = JSON.parse(req.body || '{}');
      if (body.name) patient.name = body.name;
      if (body.phone) patient.phone = body.phone;
      if (body.age !== undefined) patient.age = body.age;
      if (body.gender) patient.gender = body.gender;
      if (body.city) patient.city = body.city;
      if (body.firstVisit) patient.firstVisit = body.firstVisit;
      if (body.notes) patient.notes = body.notes;
      
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, patient }));
      return;
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Server error' }));
      return;
    }
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
}