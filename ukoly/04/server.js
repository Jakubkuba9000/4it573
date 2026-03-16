import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 3000;

const rootDir = path.dirname(new URL(import.meta.url).pathname);
const publicDir = path.join(rootDir, 'public');

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

function sendFile(res, filePath, statusCode = 200) {
  const contentType = getContentType(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('500 Internal Server Error');
    }

    res.writeHead(statusCode, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const urlPath = req.url || '/';

  if (urlPath === '/' || urlPath === '/index.html') {
    const indexPath = path.join(rootDir, 'index.html');
    return fs.access(indexPath, fs.constants.F_OK, (err) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Soubor index.html nebyl nalezen.');
      } else {
        sendFile(res, indexPath, 200);
      }
    });
  }

  const safeRequestedPath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(publicDir, safeRequestedPath.replace(/^\//, ''));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Neplatná cesta.');
  }

  fs.access(filePath, fs.constants.F_OK, (err) => {
    if (!err) {
      return sendFile(res, filePath, 200);
    }

    const notFoundPath = path.join(rootDir, '404.html');
    fs.access(notFoundPath, fs.constants.F_OK, (notFoundErr) => {
      if (notFoundErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 - Soubor nenalezen.');
      } else {
        sendFile(res, notFoundPath, 404);
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server běží na http://localhost:${PORT}`);
});