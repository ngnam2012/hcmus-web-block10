import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployRemote, appendLog, readJson, atomicJson, checkManifest } from './release.mjs';
import { handleApi, bodyJson, json, resetApi } from './server-api.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const requestLog = [];
const clientLog = [];
const faults = new Map();
function recordRequest(req, res) {
  const entry = { time: new Date().toISOString(), port: req.socket.localPort, url: req.url, method: req.method };
  res.on('finish', () => { entry.status = res.statusCode; entry.finishedAt = new Date().toISOString(); requestLog.push(entry); if (requestLog.length > 10000) requestLog.shift(); appendLog('request-log.jsonl', entry); });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const REMOTE_CONFIGS = [
  { name: 'catalog', framework: 'React 18', port: 3001, dir: path.join(ROOT, 'remotes', 'catalog', 'dist') },
  { name: 'cart', framework: 'Vue 3', port: 3002, dir: path.join(ROOT, 'remotes', 'cart', 'dist') },
  { name: 'promo', framework: 'Svelte 4', port: 3003, dir: path.join(ROOT, 'remotes', 'promo', 'dist') },
  { name: 'reviews', framework: 'Web Components', port: 3004, dir: path.join(ROOT, 'remotes', 'reviews', 'dist') }
];

/** @type {Map<number, { server: http.Server | null, cfg: typeof REMOTE_CONFIGS[0], sockets: Set<any> }>} */
const remoteControllers = new Map();

function serveStaticFile(req, res, baseDir, options = { isRemote: false }) {
  const parsedUrl = new URL(req.url || '/', 'http://localhost');
  const fault = faults.get(`${req.socket.localPort}${parsedUrl.pathname}`);
  const delayMs = Math.min(10000, Math.max(0, Number(fault?.delayMs || parsedUrl.searchParams.get('delay') || 0)));

  const respond = () => {
    if (res.destroyed) return;
    if (fault?.status === 404) { res.writeHead(404, { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' }); res.end('Injected 404'); return; }
    let safeRel;
    try { safeRel = decodeURIComponent(parsedUrl.pathname).replace(/^\/+/, ''); }
    catch { res.writeHead(400); res.end('Malformed URL'); return; }
    if (!safeRel) safeRel = 'index.html';

    const resolvedPath = path.resolve(baseDir, safeRel);
    if (resolvedPath !== path.resolve(baseDir) && !resolvedPath.startsWith(path.resolve(baseDir) + path.sep)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    let finalPath = resolvedPath;
    if (!fs.existsSync(finalPath) || fs.statSync(finalPath).isDirectory()) {
      if (!options.isRemote && !path.extname(parsedUrl.pathname) && !/^\/(api|__|remotes|shared|assets)(\/|$)/.test(parsedUrl.pathname)) {
        finalPath = path.join(baseDir, 'index.html');
      } else {
        res.writeHead(404, {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json; charset=utf-8'
        });
        res.end(JSON.stringify({ error: 'Artifact not found', path: parsedUrl.pathname }));
        return;
      }
    }

    const ext = path.extname(finalPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const fileName = path.basename(finalPath);

    // Artifact có mã băm (VD: cart.v1.a1b2c3d4.js) -> Cache bất biến 1 năm theo Phần 6
    const isHashedImmutable = /\.[a-f0-9]{8}\.js$/i.test(fileName) && delayMs === 0;

    const headers = {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cache-Control': isHashedImmutable
        ? 'public, max-age=31536000, immutable'
        : 'no-store, no-cache, must-revalidate'
    };

    res.writeHead(200, headers);
    fs.createReadStream(finalPath).pipe(res);
  };

  if (delayMs > 0) {
    setTimeout(respond, delayMs);
  } else {
    respond();
  }
}

function startRemoteServer(cfg) {
  return new Promise((resolve, reject) => {
    const existing = remoteControllers.get(cfg.port);
    if (existing?.server) {
      resolve(true);
      return;
    }

    const sockets = new Set();
    const server = http.createServer((req, res) => {
      recordRequest(req, res);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': '*'
        });
        res.end();
        return;
      }
      if (req.url === '/health') {
        res.writeHead(200, {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        });
        res.end(JSON.stringify({ ok: true, remote: cfg.name, framework: cfg.framework, port: cfg.port }));
        return;
      }
      serveStaticFile(req, res, cfg.dir, { isRemote: true });
    });

    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });

    server.on('error', reject);
    server.listen(cfg.port, '127.0.0.1', () => {
      remoteControllers.set(cfg.port, { server, cfg, sockets });
      resolve(true);
    });
  });
}

function stopRemoteServer(port) {
  return new Promise((resolve) => {
    const entry = remoteControllers.get(port);
    if (!entry || !entry.server) {
      resolve(false);
      return;
    }
    for (const s of entry.sockets) {
      s.destroy();
    }
    entry.sockets.clear();
    entry.server.close(() => {
      entry.server = null;
      resolve(false);
    });
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function startShellServer() {
  const shellDistDir = path.join(ROOT, 'shell', 'dist');
  const liveManifestPath = path.join(ROOT, 'shell', 'public', 'manifest.json');
  const versionsPath = path.join(ROOT, 'shell', 'public', 'manifest-versions.json');
  const releases = readJson(versionsPath);
  const baselineManifest = { catalog: releases.catalog['1.4.0'], cart: releases.cart['1.3.0'], promo: releases.promo['1.0.0'], reviews: releases.reviews['1.0.0'] };

  const server = http.createServer(async (req, res) => {
    recordRequest(req, res);
    try {
    const parsedUrl = new URL(req.url || '/', 'http://localhost:3000');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && ((req.headers.origin && req.headers.origin !== 'http://localhost:3000' && req.headers.origin !== 'http://127.0.0.1:3000') || !req.headers['content-type']?.startsWith('application/json'))) { json(res, 403, { error: 'JSON and same origin required' }); return; }
    if (await handleApi(req, res, parsedUrl.pathname)) return;
    if (parsedUrl.pathname === '/__log/client' && req.method === 'POST') {
      const entry = await bodyJson(req); clientLog.push(entry); appendLog('client-log.jsonl', entry); json(res, 201, { ok: true }); return;
    }
    if (parsedUrl.pathname === '/__log' && req.method === 'GET') { json(res, 200, { requests: requestLog, clients: clientLog }); return; }
    if (parsedUrl.pathname === '/__reset' && req.method === 'POST') {
      resetApi(); faults.clear(); requestLog.length = 0; clientLog.length = 0;
      atomicJson(liveManifestPath, baselineManifest); json(res, 200, { ok: true }); return;
    }
    if (parsedUrl.pathname === '/__faults' && req.method === 'POST') {
      const body = await bodyJson(req); const entry = new URL(body.url);
      const key = `${entry.port}${entry.pathname}`;
      if (body.clear) faults.delete(key); else faults.set(key, { status: body.status, delayMs: body.delayMs });
      json(res, 200, { ok: true }); return;
    }

    // 1. Phục vụ manifest.json trực tiếp với no-cache để cập nhật phiên bản ngay lập tức mà không build lại Shell
    if (parsedUrl.pathname === '/manifest.json') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      });
      res.end(fs.readFileSync(liveManifestPath, 'utf8'));
      return;
    }

    // 2. API quản trị phục vụ Phòng thí nghiệm MFE (Kiểm chứng F3, F7, F8)
    if (parsedUrl.pathname === '/__mfe_admin/status') {
      const ports = {};
      for (const cfg of REMOTE_CONFIGS) {
        ports[cfg.port] = Boolean(remoteControllers.get(cfg.port)?.server);
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ports }));
      return;
    }

    if (parsedUrl.pathname === '/__mfe_admin/toggle-port' && req.method === 'POST') {
      const body = await readJsonBody(req);
      const port = Number(body.port);
      const entry = remoteControllers.get(port);
      if (!entry) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid port' }));
        return;
      }
      if (body.action === 'stop') {
        await stopRemoteServer(port);
      } else {
        await startRemoteServer(entry.cfg);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ port, online: Boolean(remoteControllers.get(port)?.server) }));
      return;
    }

    if (parsedUrl.pathname === '/__mfe_admin/deploy-cart' && req.method === 'POST') {
      const body = await bodyJson(req);
      const result = deployRemote('cart', body.edition, 'admin deploy-cart');
      json(res, result.ok ? 200 : 409, { ...result, cartUrl: result.descriptor?.url });
      return;
    }
    if (parsedUrl.pathname === '/__mfe_admin/deploy' && req.method === 'POST') {
      const body = await bodyJson(req); const result = deployRemote(body.name, body.version, 'admin deploy');
      json(res, result.ok ? 200 : 409, result); return;
    }
    if (parsedUrl.pathname.startsWith('/__')) { json(res, 404, { error: 'Unknown lab endpoint' }); return; }

    serveStaticFile(req, res, shellDistDir, { isRemote: false });
    } catch (error) { if (!res.headersSent) json(res, 400, { error: error.message }); else res.end(); }
  });

  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(3000, '127.0.0.1', resolve);
  });
}

async function main() {
  const failures = checkManifest(readJson(path.join(ROOT, 'shell/public/manifest.json')));
  if (failures.length) throw new Error(JSON.stringify(failures));
  for (const cfg of REMOTE_CONFIGS) {
    if (!fs.existsSync(cfg.dir)) {
      console.error(`✗ Chưa có bản build tại ${cfg.dir}. Hãy chạy "npm run build" trước!`);
      process.exit(1);
    }
    await startRemoteServer(cfg);
  }

  await startShellServer();

  console.log('\n======================================================================');
  console.log(' 🚀 HỆ THỐNG MICRO FRONTEND SHOPLITE ĐANG CHẠY TRÊN 5 CỔNG ĐỘC LẬP');
  console.log('======================================================================');
  console.log(' • App Shell (Vanilla TS + Import Map) : http://localhost:3000');
  console.log(' • Remote 1 — Catalog (React 18)       : http://localhost:3001');
  console.log(' • Remote 2 — Cart & Checkout (Vue 3)  : http://localhost:3002');
  console.log(' • Remote 3 — Promo Engine (Svelte 4)  : http://localhost:3003');
  console.log(' • Remote 4 — Reviews (Web Components) : http://localhost:3004');
  console.log('======================================================================\n');
}

main().catch((err) => {
  console.error('Lỗi khởi động cụm server MFE:', err);
  process.exit(1);
});
