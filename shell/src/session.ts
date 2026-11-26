import { eventBus } from '@shoplite/event-bus';
import { BASE_SHIPPING_FEE, FREESHIP_THRESHOLD, VAT_RATE } from '@shoplite/format';
import type { UserProfile } from './types';
import { isBrowserDemo } from './runtime';

let accessToken = '';
let user: UserProfile | null = null;
let snapshot: { items: any[]; purchasedIds: string[]; stock: Record<string, number> } = { items: [], purchasedIds: [], stock: {} };
let epoch = 0;
let mutations: Promise<unknown> = Promise.resolve();
export async function api(path: string, method = 'GET', body?: unknown) {
  if (isBrowserDemo) return (await import('./browser-demo')).demoApi(path, method, body);
  const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
function publish() {
  const items = snapshot.items.map(i => ({ ...i }));
  const subtotal = items.reduce((n, i) => n + i.unitPrice * i.qty, 0);
  const shippingFee = subtotal > 0 && subtotal < FREESHIP_THRESHOLD ? BASE_SHIPPING_FEE : 0;
  eventBus.emit('cart:state', { ...snapshot, items }, 'Cart API');
  eventBus.emit('cart:updated', { items, subtotal, totalQty: items.reduce((n, i) => n + i.qty, 0), shippingFee, discount: 0, finalTotal: subtotal + shippingFee + Math.round(subtotal * VAT_RATE) }, 'Cart API');
}
export async function syncSession(userId?: string | null) {
  const turn = ++epoch;
  accessToken = ''; user = null; snapshot = { items: [], purchasedIds: [], stock: {} };
  eventBus.clearSession(); publish();
  const data = await api('/api/session', userId === null ? 'DELETE' : userId ? 'POST' : 'GET', userId ? { userId } : undefined);
  if (turn !== epoch) return user;
  user = data.user; accessToken = data.accessToken || '';
  const cart = user ? await api('/api/cart/v1') : snapshot;
  if (turn !== epoch) return user;
  snapshot = cart;
  publish(); return user;
}
export const getAccessToken = async () => { if (!accessToken) throw new Error('Vui lòng đăng nhập'); return accessToken; };
export function cartForSession() {
  const capturedEpoch = epoch;
  const mutate = (body: unknown) => {
    const operation = mutations.catch(() => {}).then(async () => {
    if (capturedEpoch !== epoch || !user) throw new Error('Phiên đăng nhập đã thay đổi');
    const data = await api('/api/cart/v1', 'POST', body);
    if (capturedEpoch !== epoch) throw new Error('Phiên đăng nhập đã thay đổi');
    snapshot = data; publish();
    eventBus.emit('cart:operation-confirmed', {}, 'Cart API');
    return structuredClone(snapshot);
    });
    mutations = operation;
    return operation;
  };
  return {
    getSnapshot: () => structuredClone(snapshot),
    add: (item: any) => mutate({ op: 'add', productId: item.productId, variantId: item.variantId }),
    quantity: (sku: string, qty: number) => mutate({ op: 'quantity', sku, qty }),
    adjustQuantity: (sku: string, delta: number) => mutate({ op: 'adjust', sku, delta }),
    clear: () => mutate({ op: 'clear' }),
    resetStock: () => mutate({ op: 'reset-stock' }),
    checkout: () => mutate({ op: 'checkout' })
  };
}
