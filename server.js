// PIRO local dev server — replaces netlify dev for local testing
// Usage: node server.js
// Serves static files + proxies /api/chat to the Netlify function handler

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 8888;
const ROOT = __dirname;

// Load .env
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
    const eq = line.indexOf('=');
    if (eq > 0) process.env[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  });
}

// خواندن پورت proxy از رجیستری ویندوز (Psiphon پورت رو dynamic انتخاب می‌کنه)
try {
  const { execSync } = require('child_process');
  const reg = execSync(
    'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer',
    { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }
  );
  const match = reg.match(/https?=([^;]+)/);
  if (match) {
    process.env.HTTPS_PROXY = `http://${match[1]}`;
    console.log(`✓ Proxy detected: ${process.env.HTTPS_PROXY}`);
  }
} catch {}

const { handler } = require('./netlify/functions/chat');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.woff': 'font/woff',
  '.ttf':  'font/ttf',
  '.json': 'application/json',
};

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    });
    return res.end();
  }

  // API endpoint — forward to Netlify function handler
  if (req.url === '/api/chat') {
    const chunks = [];
    req.on('data', chunk => { chunks.push(chunk); });
    req.on('end', async () => {
      // باید همه بایت‌ها اول جمع بشن و بعد یک‌جا decode بشن — وگرنه کاراکترهای
      // چندبایتی UTF-8 (فارسی) که نقطه برش chunk وسطشون بیفته خراب می‌شن
      const body = Buffer.concat(chunks).toString('utf8');
      try {
        const result = await handler({ httpMethod: req.method, body, headers: req.headers });
        res.writeHead(result.statusCode, result.headers || {});
        res.end(result.body);
      } catch (e) {
        console.error('Function error:', e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });
    return;
  }

  // Static files
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(ROOT, urlPath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('404 Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`\n✓ PIRO dev server → http://localhost:${PORT}\n`);
});
