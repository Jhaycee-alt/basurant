const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const ROOT_DIR = __dirname;
const REPORTS_FILE = path.join(ROOT_DIR, 'reports.json');

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function ensureReportsFile() {
  if (!fs.existsSync(REPORTS_FILE)) {
    fs.writeFileSync(REPORTS_FILE, JSON.stringify([], null, 2), 'utf8');
  }
}

function appendReport(report) {
  ensureReportsFile();
  const raw = fs.readFileSync(REPORTS_FILE, 'utf8');
  const list = raw ? JSON.parse(raw) : [];
  list.push(report);
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(list, null, 2), 'utf8');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/report.html' : req.url;
  filePath = filePath.split('?')[0];
  const resolvedPath = path.join(ROOT_DIR, filePath);
  if (!resolvedPath.startsWith(ROOT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(resolvedPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(resolvedPath).toLowerCase();
    const contentTypeMap = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml'
    };
    const contentType = contentTypeMap[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/api/reports') {
    try {
      const report = await readJsonBody(req);
      if (!report || !report.id) {
        sendJson(res, 400, { error: 'Invalid report payload' });
        return;
      }
      appendReport(report);
      sendJson(res, 201, { ok: true });
    } catch (e) {
      sendJson(res, 500, { error: 'Failed to save report' });
    }
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log('Server running at http://localhost:' + PORT);
});
