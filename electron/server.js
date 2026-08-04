const http = require('http');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(
  process.env.APPDATA || process.env.HOME || '.',
  'SparkMindsLab',
  'data.json'
);

const dataDir = path.dirname(DATA_FILE);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let store = {};
try {
  store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
} catch (e) { store = {}; }

function persist() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(store)); } catch (e) {}
}

const kvStore = {
  async get(key) { return store[key] !== undefined ? store[key] : null; },
  async put(key, value) { store[key] = value; persist(); },
  async delete(key) { delete store[key]; persist(); },
  async list() { return Object.keys(store).map(name => ({ name })); },
};

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

const assetsHandler = {
  async fetch(request) {
    const url = new URL(request.url);
    let filePath = path.join(PUBLIC_DIR, url.pathname);
    if (url.pathname === '/' || !fs.existsSync(filePath)) {
      filePath = path.join(PUBLIC_DIR, 'index.html');
    }
    try {
      const content = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = MIME_TYPES[ext] || 'application/octet-stream';
      return new Response(content, {
        status: 200,
        headers: { 'Content-Type': mime },
      });
    } catch (e) {
      return new Response('Not Found', { status: 404 });
    }
  },
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function createRequest(req) {
  const url = `http://localhost${req.url}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  const hasBody = !['GET', 'HEAD'].includes(req.method);
  const body = hasBody ? await readBody(req) : undefined;
  return new Request(url, {
    method: req.method,
    headers,
    body,
  });
}

function sendResponse(res, response) {
  response.arrayBuffer().then(buf => {
    const headers = {};
    response.headers.forEach((v, k) => { headers[k] = v; });
    headers['Access-Control-Allow-Origin'] = '*';
    res.writeHead(response.status, headers);
    res.end(Buffer.from(buf));
  });
}

async function startServer(port) {
  const workerCode = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'worker.js'),
    'utf8'
  );

  const moduleObj = { exports: {} };
  const fn = new Function('module', 'exports', 'require', 'Request', 'Response', 'Headers', 'URL',
    workerCode.replace(/^\s*export default\s*/m, 'module.exports = ')
  );
  fn(moduleObj, moduleObj.exports, require, Request, Response, Headers, URL);
  const worker = moduleObj.exports;

  const env = { USERS: kvStore, ASSETS: assetsHandler };

  const server = http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      res.end();
      return;
    }

    try {
      const request = await createRequest(req);
      const response = await worker.fetch(request, env, {});
      sendResponse(res, response);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, msg: '服务器错误: ' + e.message }));
    }
  });

  return new Promise(resolve => {
    server.listen(port, () => resolve(server));
  });
}

module.exports = { startServer };
