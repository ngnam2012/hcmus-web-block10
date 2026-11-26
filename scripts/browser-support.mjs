import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './release.mjs';
import { until, request, pause } from './test-support.mjs';
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url); this.next = 1; this.pending = new Map(); this.events = [];
    this.ready = new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = event => {
      const data = JSON.parse(event.data);
      if (data.id) { const p = this.pending.get(data.id); if (!p) return; this.pending.delete(data.id); clearTimeout(p.timer); data.error ? p.reject(new Error(JSON.stringify(data.error))) : p.resolve(data.result); }
      else this.events.push(data);
    };
  }
  async call(method, params = {}) {
    await this.ready;
    return new Promise((resolve, reject) => {
      const id = this.next++, timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP timeout ' + method)); }, 15000);
      this.pending.set(id, { resolve, reject, timer }); this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const response = await this.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails)); return response.result.value;
  }
  async wait(expression, timeout) { return until(() => this.eval(expression), timeout); }
  async click(selector) { await this.eval(`(() => {const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('Missing ${selector}');el.click()})()`); }
  async route(pathname) { await this.eval(`document.querySelector('[data-route][href="${pathname}"]').click()`); }
  close() { this.ws.close(); }
}
export async function browser() {
  const executable = process.env.CHROME_BIN || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => fs.existsSync(p));
  if (!executable) throw new Error('Set CHROME_BIN to an installed Chrome/Chromium executable.');
  const profile = path.join(ROOT, '.audit', `chrome-profile-${process.pid}`); fs.mkdirSync(profile, { recursive: true });
  const proc = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  let processError; proc.on('error', e => { processError = e; });
  let port;
  try { port = await until(() => { if (processError) throw processError; const file = path.join(profile, 'DevToolsActivePort'); return fs.existsSync(file) && fs.readFileSync(file, 'utf8').split('\n')[0]; }); }
  catch (error) { proc.kill(); throw error; }
  const pages = [];
  return {
    async open(pathname = '/products', login = true) {
      const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
      const c = new CDP(target.webSocketDebuggerUrl); pages.push(c);
      await c.call('Page.enable'); await c.call('Runtime.enable'); await c.call('Network.enable'); await c.call('Log.enable');
      // Each fault case must hit the server; ES module caching within a page is retained.
      await c.call('Network.setCacheDisabled', { cacheDisabled: true });
      if (login) {
        const token = (await request('/api/session', { userId: 'u1' })).data.accessToken;
        await c.call('Network.setCookie', { name: 'shoplite_session', value: token, domain: 'localhost', path: '/', httpOnly: true, sameSite: 'Strict' });
      }
      await c.call('Page.navigate', { url: 'http://localhost:3000' + pathname });
      return c;
    },
    async close() {
      pages.forEach(c => c.close()); proc.kill(); await pause(800);
      const resolved = path.resolve(profile), audit = path.resolve(ROOT, '.audit') + path.sep;
      if (resolved.startsWith(audit) && path.basename(resolved) === `chrome-profile-${process.pid}`) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 4, retryDelay: 300 });
    }
  };
}
