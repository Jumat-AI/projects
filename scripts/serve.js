const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ROOT_DIR = path.join(__dirname, '..');
const HUB_DIR = path.join(ROOT_DIR, 'hub');
const PROJECTS_DIR = path.join(ROOT_DIR, 'projects');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

function serveFile(res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404 Not Found</h1><p>File tidak ditemukan.</p>');
    return;
  }

  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    const indexPath = path.join(filePath, 'index.html');
    if (fs.existsSync(indexPath)) {
      return serveFile(res, indexPath);
    }
    res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>403 Forbidden</h1><p>Direktori listing dimatikan.</p>');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  res.writeHead(200, {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*'
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  // 1. Root / Hub assets (/)
  if (pathname === '/' || pathname === '/index.html') {
    return serveFile(res, path.join(HUB_DIR, 'index.html'));
  }

  // 2. Hub direct assets (/projects.json, /styles.css, /app.js)
  const directHubFile = path.join(HUB_DIR, pathname.replace(/^\//, ''));
  if (fs.existsSync(directHubFile) && fs.statSync(directHubFile).isFile()) {
    return serveFile(res, directHubFile);
  }

  // 3. Project routing: /<slug> atau /<slug>/...
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length > 0) {
    const slug = parts[0];
    const projectFolder = path.join(PROJECTS_DIR, slug);

    if (fs.existsSync(projectFolder) && fs.statSync(projectFolder).isDirectory()) {
      const subPath = parts.slice(1).join('/');
      const targetPath = subPath ? path.join(projectFolder, subPath) : path.join(projectFolder, 'index.html');
      return serveFile(res, targetPath);
    }
  }

  // Fallback 404
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>404 Not Found</h1><p>Halaman atau project tidak ditemukan.</p>');
});

server.listen(PORT, () => {
  console.log(`\n🚀 Dev Server berjalan di: \x1b[36mhttp://localhost:${PORT}\x1b[0m`);
  console.log(`📁 Melayani Katalog Utama: \x1b[32mhttp://localhost:${PORT}/\x1b[0m`);
  console.log(`📁 Melayani Project:       \x1b[32mhttp://localhost:${PORT}/<nama_project>/\x1b[0m\n`);
});
