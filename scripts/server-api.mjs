import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, atomicJson, readJson } from './release.mjs';

export const users = { u1: { id: 'u1', name: 'Nguyễn Minh Anh', tier: 'VIP' }, u2: { id: 'u2', name: 'Trần Quốc Tuấn', tier: 'Member' } };
const sessions = new Map();
const stateFile = path.join(process.env.SHOPLITE_DATA_DIR || path.join(ROOT, '.data'), 'carts.json');
let state = fs.existsSync(stateFile) ? readJson(stateFile) : {};
export const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
export async function bodyJson(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 128_000) throw new Error('Body too large'); }
  return raw ? JSON.parse(raw) : {};
}
export function resetApi() { sessions.clear(); state = {}; atomicJson(stateFile, state); }
function resolveSession(req) {
  const cookie = req.headers.cookie?.match(/(?:^|;\s*)shoplite_session=([^;]+)/)?.[1];
  const token = req.headers.authorization?.replace(/^Bearer /, '') || cookie;
  const session = sessions.get(token);
  if (session && session.expires > Date.now()) return { ...session, token };
  return null;
}
export async function handleApi(req, res, pathname) {
  if (!pathname.startsWith('/api/')) return false;
  const session = resolveSession(req);
  if (pathname === '/api/session') {
    if (req.method === 'GET') { json(res, 200, { user: session ? users[session.userId] : null, accessToken: session?.token || null }); return true; }
    if (req.method === 'DELETE') {
      if (session) sessions.delete(session.token);
      res.setHeader('Set-Cookie', 'shoplite_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      json(res, 200, { user: null }); return true;
    }
    if (req.method === 'POST') {
      const body = await bodyJson(req);
      if (!users[body.userId]) { json(res, 400, { error: 'Unknown demo account' }); return true; }
      if (session) sessions.delete(session.token);
      const token = crypto.randomBytes(32).toString('hex');
      sessions.set(token, { userId: body.userId, expires: Date.now() + 3_600_000 });
      res.setHeader('Set-Cookie', `shoplite_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600`);
      json(res, 200, { user: users[body.userId], accessToken: token }); return true;
    }
  }
  if (pathname === '/api/cart/v1') {
    if (!session) { json(res, 401, { error: 'Login required' }); return true; }
    const cart = state[session.userId] ||= { items: [], purchasedIds: [] };
    const products = readJson(path.join(ROOT, 'remotes/catalog/dist/products.json'));
    const stock = state.__stock ||= Object.fromEntries(products.map(p => [p.id, p.initialStock]));
    const snapshot = () => ({ ...cart, stock });
    if (req.method === 'GET') { json(res, 200, snapshot()); return true; }
    if (req.method === 'POST') {
      const body = await bodyJson(req);
      if (body.op === 'add') {
        const product = products.find(p => p.id === body.productId);
        const variant = product?.variants.find(v => v.id === body.variantId);
        if (!product || !variant) { json(res, 400, { error: 'Unknown product/variant' }); return true; }
        const sku = `${product.id}__${variant.id}`;
        if (cart.items.filter(i => i.productId === product.id).reduce((n, i) => n + i.qty, 0) >= stock[product.id]) { json(res, 409, { error: 'Đã đạt giới hạn tồn kho' }); return true; }
        const item = cart.items.find(i => i.sku === sku);
        if (item) item.qty++;
        else cart.items.push({ sku, productId: product.id, code: product.code, name: product.name, variantLabel: variant.label, unitPrice: product.basePrice + variant.priceDelta, qty: 1, maxStock: stock[product.id] });
      } else if (body.op === 'quantity' || body.op === 'adjust') {
        const item = cart.items.find(i => i.sku === body.sku);
        const qty = body.op === 'adjust' && item && Number.isSafeInteger(body.delta) ? Math.max(0, item.qty + body.delta) : body.qty;
        if (!item || !Number.isSafeInteger(qty) || qty < 0) { json(res, 400, { error: 'Invalid quantity' }); return true; }
        const others = cart.items.filter(i => i.productId === item.productId && i.sku !== item.sku).reduce((n, i) => n + i.qty, 0);
        if (others + qty > stock[item.productId]) { json(res, 409, { error: 'Đã đạt giới hạn tồn kho' }); return true; }
        item.qty = qty; cart.items = cart.items.filter(i => i.qty > 0);
      } else if (body.op === 'clear') cart.items = [];
      else if (body.op === 'checkout') {
        if (!cart.items.length) { json(res, 400, { error: 'Giỏ hàng trống' }); return true; }
        const quantities = {};
        for (const item of cart.items) quantities[item.productId] = (quantities[item.productId] || 0) + item.qty;
        if (Object.entries(quantities).some(([id, qty]) => qty > stock[id])) { json(res, 409, { error: 'Tồn kho đã thay đổi. Vui lòng cập nhật giỏ.' }); return true; }
        for (const [id, qty] of Object.entries(quantities)) stock[id] -= qty;
        cart.purchasedIds = [...new Set([...cart.purchasedIds, ...cart.items.map(i => i.productId)])]; cart.items = [];
      } else if (body.op === 'reset-stock') Object.assign(stock, Object.fromEntries(products.map(p => [p.id, p.initialStock])));
      else { json(res, 400, { error: 'Unknown operation' }); return true; }
      atomicJson(stateFile, state); json(res, 200, snapshot()); return true;
    }
  }
  json(res, 404, { error: 'Unknown API endpoint' }); return true;
}
