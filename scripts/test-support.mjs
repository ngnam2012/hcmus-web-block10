import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { ROOT, manifestPath, publicDir } from './release.mjs';
export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function until(fn, timeout = 12000) {
  const deadline = Date.now() + timeout; let last;
  while (Date.now() < deadline) { try { const value = await fn(); if (value) return value; } catch (e) { last = e; } await pause(80); }
  throw new Error(`Timed out: ${fn.toString().slice(0, 220)} ${last || ''}`);
}
export async function request(pathname, body, method = body === undefined ? 'GET' : 'POST', token) {
  const response = await fetch('http://localhost:3000' + pathname, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
export async function testServer() {
  const files = [manifestPath, path.join(publicDir, 'manifest-versions.json')];
  const saved = files.map(file => fs.readFileSync(file));
  const runtime = path.join(ROOT, '.audit', `test-runtime-${process.pid}`);
  const server = spawn(process.execPath, ['scripts/start-all.mjs'], { cwd: ROOT, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SHOPLITE_DATA_DIR: runtime } });
  let output = ''; server.stdout.on('data', b => output += b); server.stderr.on('data', b => output += b);
  server.on('error', e => { output += e.message; });
  try {
    await until(() => { if (server.exitCode !== null) throw new Error(output); return output.includes('http://localhost:3000'); }, 10000);
  } catch (error) { server.kill(); throw new Error(`${error}\n${output}`); }
  return { runtime, async close() {
    server.kill(); await Promise.race([once(server, 'exit'), pause(3000)]);
    files.forEach((file, i) => fs.writeFileSync(file, saved[i]));
  } };
}
