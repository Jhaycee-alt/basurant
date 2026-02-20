const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 3000);
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

function readReports() {
  ensureReportsFile();
  const raw = fs.readFileSync(REPORTS_FILE, 'utf8');
  const list = raw ? JSON.parse(raw) : [];
  return Array.isArray(list) ? list : [];
}

function writeReports(list) {
  fs.writeFileSync(REPORTS_FILE, JSON.stringify(Array.isArray(list) ? list : [], null, 2), 'utf8');
}

function buildNextReportIdFromJson() {
  const reports = readReports();
  let maxNumber = 0;

  reports.forEach(report => {
    try {
      const id = report && report.id ? String(report.id) : '';
      const match = /^R-(\d{5})\d{8}$/.exec(id);
      if (!match) return;
      const num = Number(match[1]);
      if (Number.isFinite(num) && num > maxNumber) maxNumber = num;
    } catch (e) {}
  });

  const nextNumber = maxNumber + 1;
  const now = new Date();
  const datePart = String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + String(now.getFullYear());
  const numPart = String(nextNumber).padStart(5, '0');
  return 'R-' + numPart + datePart;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(payload));
}

function serveStatic(req, res) {
  let filePath = req.url === '/' ? '/report.html' : req.url;
  filePath = filePath.split('?')[0];
  try {
    filePath = decodeURIComponent(filePath);
  } catch (e) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
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
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/api/reports') {
    try {
      const list = readReports();
      sendJson(res, 200, { reports: list });
    } catch (e) {
      sendJson(res, 500, { error: 'Failed to read reports' });
    }
    return;
  }

  if (req.method === 'GET' && req.url === '/api/reports/next-id') {
    try {
      const nextId = buildNextReportIdFromJson();
      sendJson(res, 200, { id: nextId });
    } catch (e) {
      sendJson(res, 500, { error: 'Failed to generate next report id' });
    }
    return;
  }

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

  if (req.method === 'POST' && req.url === '/api/reports/bulk') {
    try {
      const payload = await readJsonBody(req);
      const incoming = Array.isArray(payload?.reports) ? payload.reports : [];
      if (!incoming.length) {
        sendJson(res, 400, { error: 'No reports provided' });
        return;
      }

      const existing = readReports();
      const byId = new Map();
      existing.forEach(r => {
        if (r && r.id) byId.set(String(r.id), r);
      });
      incoming.forEach(r => {
        if (r && r.id) byId.set(String(r.id), r);
      });

      const merged = Array.from(byId.values());
      writeReports(merged);
      sendJson(res, 200, { ok: true, count: merged.length });
    } catch (e) {
      sendJson(res, 500, { error: 'Failed to save bulk reports' });
    }
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log('Server running at http://localhost:' + PORT);
});
