// Local test double for a static-only host (like the Vercel mirror):
// serves the built public/ files WITHOUT any /api backend.
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.env.MOCK_ROOT ? path.resolve(process.env.MOCK_ROOT) : path.resolve(__dirname, '..', 'public');
http
  .createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    if (p.startsWith('/api/')) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('no backend on this host');
      return;
    }
    const file = path.resolve(ROOT, '.' + p);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const types = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.json': 'application/json',
        '.webmanifest': 'application/manifest+json',
      };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      res.end(data);
    });
  })
  .listen(process.env.PORT || 3000, '127.0.0.1', () => {
    console.log('static mock on http://127.0.0.1:' + (process.env.PORT || 3000));
  });
