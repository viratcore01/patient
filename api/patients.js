export default function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    return res.end();
  }

  // ONLY return static data - NO file operations, NO Oracle, NO dynamic code
  // This ensures the function never crashes on cold start

  // GET /api/health
  if (req.url === '/api/health' || req.url === '/api/health\n') {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // GET /api/patients - return static embedded data
  if (req.url === '/api/patients' && req.method === 'GET') {
    res.statusCode = 200;
    res.end(JSON.stringify({
      patients: [
        { id: 'HM-2026-0001', name: 'Sample Patient', phone: '9876543210', age: 30, gender: 'Male', city: 'City', firstVisit: '2024-01-01', notes: 'Sample notes' }
      ]
    }));
    return;
  }

  // PUT /api/patients/:reg - static response
  if (req.method === 'PUT' && req.url.match(/^\/api\/patients\//)) {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // GET /api/notes - static
  if (req.url === '/api/notes' && req.method === 'GET') {
    res.statusCode = 200;
    res.end(JSON.stringify({ notes: {} }));
    return;
  }

  // GET/PUT /api/notes/:reg - static
  if (req.url.match(/^\/api\/notes\//) && req.method === 'PUT') {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
}