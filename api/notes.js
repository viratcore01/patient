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

  // ONLY static responses - NO file operations, NO Oracle, NO dynamic code

  // GET /api/health
  if (req.url === '/api/health' || req.url === '/api/health\n') {
    res.statusCode = 200;
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // GET /api/notes
  if (req.url === '/api/notes' && req.method === 'GET') {
    res.statusCode = 200;
    res.end(JSON.stringify({ notes: {} }));
    return;
  }

  // GET/PUT /api/notes/:reg
  if (req.url.match(/^\/api\/notes\//)) {
    if (req.method === 'GET') {
      res.statusCode = 200;
      res.end(JSON.stringify({ notes: '' }));
      return;
    }
    if (req.method === 'PUT') {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
      return;
    }
  }

  // All other routes
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
}