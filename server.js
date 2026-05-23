const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

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

  // Serve de monitor app
  if (req.url === '/' || req.url === '/index.html') {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('index.html niet gevonden'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'LibreLinkUp proxy' }));
    return;
  }

  // Proxy: /proxy/api-eu.libreview.io/llu/auth/login
  const parts = req.url.slice(1).split('/');
  if (parts[0] !== 'proxy' || parts.length < 2) {
    res.writeHead(400); res.end('Gebruik /proxy/<host>/<pad>'); return;
  }

  const targetHost = parts[1];
  const targetPath = '/' + parts.slice(2).join('/');

  if (!ALLOWED_HOSTS.includes(targetHost)) {
    res.writeHead(403); res.end('Host niet toegestaan'); return;
  }

  // Bouw headers op — verwijder encoding zodat we plain JSON krijgen
  const forwardHeaders = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (!['host', 'origin', 'referer', 'connection', 'accept-encoding'].includes(k.toLowerCase())) {
      forwardHeaders[k] = v;
    }
  }
  forwardHeaders['host'] = targetHost;
  forwardHeaders['accept-encoding'] = 'identity'; // geen gzip/deflate

  console.log(`${new Date().toISOString()} ${req.method} → https://${targetHost}${targetPath}`);

  // Lees request body eerst volledig in
  let body = [];
  req.on('data', chunk => body.push(chunk));
  req.on('end', () => {
    const bodyBuffer = Buffer.concat(body);

    const proxyReq = https.request(
      { hostname: targetHost, port: 443, path: targetPath, method: req.method, headers: forwardHeaders },
      (proxyRes) => {
        const encoding = proxyRes.headers['content-encoding'];
        let stream = proxyRes;

        // Decomprimeer indien nodig
        if (encoding === 'gzip') {
          stream = proxyRes.pipe(zlib.createGunzip());
        } else if (encoding === 'deflate') {
          stream = proxyRes.pipe(zlib.createInflate());
        } else if (encoding === 'br') {
          stream = proxyRes.pipe(zlib.createBrotliDecompress());
        }

        // Verzamel volledige response
        let chunks = [];
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => {
          const responseBody = Buffer.concat(chunks);
          res.writeHead(proxyRes.statusCode, {
            'Content-Type': 'application/json; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
            'Content-Length': responseBody.length,
          });
          res.end(responseBody);
          console.log(`  ← ${proxyRes.statusCode} (${responseBody.length} bytes)`);
        });
        stream.on('error', (e) => {
          console.error('Decompress fout:', e.message);
          res.writeHead(502); res.end(JSON.stringify({ error: 'Decompress fout: ' + e.message }));
        });
      }
    );

    proxyReq.on('error', (e) => {
      console.error('Proxy fout:', e.message);
      res.writeHead(502); res.end(JSON.stringify({ error: e.message }));
    });

    if (bodyBuffer.length > 0) proxyReq.write(bodyBuffer);
    proxyReq.end();
  });
});

server.listen(PORT, () => {
  console.log(`LibreStatus actief op poort ${PORT}`);
});
