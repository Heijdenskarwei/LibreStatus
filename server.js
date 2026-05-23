/**
 * LibreLinkUp CORS Proxy — Railway deployment
 */

const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3456;

const ALLOWED_HOSTS = [
  'api-eu.libreview.io',
  'api-eu2.libreview.io',
  'api-de.libreview.io',
  'api-fr.libreview.io',
  'api.libreview.io',
  'api-au.libreview.io',
  'api-ca.libreview.io',
];

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'LibreLinkUp proxy' }));
    return;
  }

  // Verwacht: /proxy/api-eu.libreview.io/llu/auth/login
  const parts = req.url.slice(1).split('/');
  if (parts[0] !== 'proxy' || parts.length < 2) {
    res.writeHead(400); res.end('Gebruik /proxy/<host>/<pad>'); return;
  }

  const targetHost = parts[1];
  const targetPath = '/' + parts.slice(2).join('/');

  if (!ALLOWED_HOSTS.includes(targetHost)) {
    res.writeHead(403); res.end('Host niet toegestaan'); return;
  }

  const forwardHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!['host', 'origin', 'referer', 'connection'].includes(k.toLowerCase())) {
      forwardHeaders[k] = v;
    }
  }
  forwardHeaders['host'] = targetHost;

  console.log(`${new Date().toISOString()} ${req.method} → https://${targetHost}${targetPath}`);

  const proxyReq = https.request(
    { hostname: targetHost, port: 443, path: targetPath, method: req.method, headers: forwardHeaders },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, {
        'Content-Type': proxyRes.headers['content-type'] || 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      proxyRes.pipe(res, { end: true });
    }
  );

  proxyReq.on('error', (e) => {
    res.writeHead(502); res.end(JSON.stringify({ error: e.message }));
  });

  req.pipe(proxyReq, { end: true });
});

server.listen(PORT, () => {
  console.log(`LibreLinkUp proxy actief op poort ${PORT}`);
});
