const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

const server = http.createServer((req, res) => {
  // Set COOP/COEP headers for SharedArrayBuffer
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Access-Control-Allow-Origin', '*');

  let filePath = '.' + req.url;
  if (filePath === './') {
    filePath = './index.html';
  }

  // Handle SDK files from parent directory
  if (filePath.startsWith('./aegis-sdk/')) {
    filePath = '../' + filePath.substring(2);
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = MIME_TYPES[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/html' });
        res.end('<h1>404 Not Found</h1>', 'utf-8');
      } else {
        res.writeHead(500);
        res.end('Server Error: ' + error.code, 'utf-8');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`Aegis Lens Demo Server Running`);
  console.log(`========================================`);
  console.log(`Open in Chrome: http://localhost:${PORT}`);
  console.log(`\nIMPORTANT: Use Chrome or Edge (Firefox/Safari not supported)`);
  console.log(`========================================\n`);
});
