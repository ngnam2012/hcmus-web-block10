import type { UserProfile } from './types';

const USERS: Record<string, UserProfile> = {
  u1: { id: 'u1', name: 'Nguyễn Minh Anh', tier: 'VIP' },
  u2: { id: 'u2', name: 'Trần Quốc Tuấn', tier: 'Member' }
};
const USER_KEY = 'shoplite.demo.user.v1';
const STOCK_KEY = 'shoplite.demo.stock.v1';
interface DemoItem { sku: string; productId: string; code: string; name: string; variantLabel: string; unitPrice: number; qty: number; maxStock: number; }
interface DemoCart { items: DemoItem[]; purchasedIds: string[]; }
type Product = typeof import('../../remotes/catalog/src/data').INITIAL_PRODUCTS[number];
let productsPromise: Promise<Product[]> | undefined;
function products(): Promise<Product[]> {
  return productsPromise ||= fetch('/demo/products.json', { cache: 'no-store' }).then(async response => {
    if (!response.ok) throw new Error('Không tải được danh mục sản phẩm demo.');
    return response.json();
  }).catch(error => { productsPromise = undefined; throw error; });
}
function read<T>(key: string, fallback: T): T {
  const saved = localStorage.getItem(key);
  try { return saved ? JSON.parse(saved) : structuredClone(fallback); }
  catch { return structuredClone(fallback); }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch { throw new Error('Trình duyệt không cho lưu dữ liệu demo. Hãy cho phép lưu dữ liệu của trang.'); }
}
function currentUser() {
  const saved = sessionStorage.getItem(USER_KEY);
  // First visit opens the demo; an explicit logout remains logged out on reload.
  const id = saved === null ? 'u1' : saved;
  if (saved === null) sessionStorage.setItem(USER_KEY, id);
  return USERS[id] || null;
}
export async function demoApi(pathname: string, method: string, body: any = {}) {
  if (pathname === '/api/session') {
    if (method === 'DELETE') { sessionStorage.setItem(USER_KEY, ''); return { user: null, accessToken: null }; }
    if (method === 'POST') {
      if (!USERS[body.userId]) throw new Error('Tài khoản demo không tồn tại.');
      sessionStorage.setItem(USER_KEY, body.userId);
    } else if (method !== 'GET') throw new Error('Thao tác phiên demo không hợp lệ.');
    const user = currentUser();
    return { user: user ? { ...user } : null, accessToken: user ? `browser-demo:${user.id}` : null };
  }
  if (pathname !== '/api/cart/v1') throw new Error('Chức năng này cần máy chủ API.');
  const user = currentUser();
  if (!user) throw new Error('Vui lòng chọn tài khoản demo.');
  const catalog = await products();
  const operation = () => {
    const cartKey = `shoplite.demo.cart.v1:${user.id}`;
    const cart = read<DemoCart>(cartKey, { items: [], purchasedIds: [] });
    if (!Array.isArray(cart.items) || !Array.isArray(cart.purchasedIds)) throw new Error('Dữ liệu giỏ demo không hợp lệ.');
    const initialStock = Object.fromEntries(catalog.map(p => [p.id, p.initialStock]));
    const stock = { ...initialStock, ...read<Record<string, number>>(STOCK_KEY, {}) };
    if (method === 'POST') {
      if (body.op === 'add') {
        const product = catalog.find(p => p.id === body.productId);
        const variant = product?.variants.find(v => v.id === body.variantId);
        if (!product || !variant) throw new Error('Sản phẩm hoặc phiên bản không tồn tại.');
        const reserved = cart.items.filter(i => i.productId === product.id).reduce((n, i) => n + i.qty, 0);
        if (reserved >= stock[product.id]) throw new Error('Đã đạt giới hạn tồn kho.');
        const sku = `${product.id}__${variant.id}`, existing = cart.items.find(i => i.sku === sku);
        if (existing) existing.qty++;
        else cart.items.push({ sku, productId: product.id, code: product.code, name: product.name, variantLabel: variant.label, unitPrice: product.basePrice + variant.priceDelta, qty: 1, maxStock: stock[product.id] });
      } else if (body.op === 'quantity' || body.op === 'adjust') {
        const item = cart.items.find(i => i.sku === body.sku);
        if (!item) throw new Error('Không tìm thấy sản phẩm trong giỏ.');
        const qty = body.op === 'adjust' && Number.isSafeInteger(body.delta) ? Math.max(0, item.qty + body.delta) : body.qty;
        if (!Number.isSafeInteger(qty) || qty < 0) throw new Error('Số lượng không hợp lệ.');
        const others = cart.items.filter(i => i.productId === item.productId && i.sku !== item.sku).reduce((n, i) => n + i.qty, 0);
        if (others + qty > stock[item.productId]) throw new Error('Đã đạt giới hạn tồn kho.');
        item.qty = qty; cart.items = cart.items.filter(i => i.qty > 0);
      } else if (body.op === 'clear') cart.items = [];
      else if (body.op === 'checkout') {
        if (!cart.items.length) throw new Error('Giỏ hàng trống.');
        const quantities: Record<string, number> = {};
        for (const item of cart.items) quantities[item.productId] = (quantities[item.productId] || 0) + item.qty;
        if (Object.entries(quantities).some(([id, qty]) => qty > stock[id])) throw new Error('Tồn kho đã thay đổi. Vui lòng cập nhật giỏ.');
        for (const [id, qty] of Object.entries(quantities)) stock[id] -= qty;
        cart.purchasedIds = [...new Set([...cart.purchasedIds, ...cart.items.map(i => i.productId)])]; cart.items = [];
      } else if (body.op === 'reset-stock') Object.assign(stock, initialStock);
      else throw new Error('Thao tác giỏ demo không hợp lệ.');
      write(STOCK_KEY, stock); write(cartKey, cart);
    } else if (method !== 'GET') throw new Error('Thao tác giỏ demo không hợp lệ.');
    return structuredClone({ ...cart, stock });
  };
  // Keep updates consistent when the same demo is open in several tabs.
  return navigator.locks ? navigator.locks.request('shoplite-demo-cart', operation) : operation();
}
