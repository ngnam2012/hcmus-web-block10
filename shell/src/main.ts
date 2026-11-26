import { createScopedBus, eventBus } from '@shoplite/event-bus';
import { SHARED_FORMAT_VERSION, formatVND } from '@shoplite/format';
import { loadRemote, unmountSlotIfMounted, reportClient } from './loader';
import { syncSession, cartForSession, getAccessToken } from './session';
import { isBrowserDemo } from './runtime';
import '@shop/ds';
import './styles.css';
import type { AppContext, RemoteManifest, SlotKey, SlotRuntimeState, UserProfile } from './types';
import { registerDesignSystemPrimitives } from './ui-primitives';

registerDesignSystemPrimitives();

const SLOT_CONFIG: Record<SlotKey, { label: string; framework: string; port: number }> = {
  promo: { label: 'Promo & Voucher', framework: 'Svelte 4', port: 3003 },
  catalog: { label: 'Product Catalog', framework: 'React 18', port: 3001 },
  cart: { label: 'Smart Cart & Checkout', framework: 'Vue 3', port: 3002 },
  reviews: { label: 'Verified Reviews Hub', framework: 'Web Components', port: 3004 }
};

let currentManifest = {} as RemoteManifest;
let supportedContractMajors: number[] = [1];
let routeTurn = 0;
let sessionChanging = false;

let currentTheme: 'light' | 'dark' = 'light';
let currentUser: UserProfile = {
  id: 'guest',
  name: 'Khách',
  tier: 'Member'
};

const slotStates = new Map<SlotKey, SlotRuntimeState>();
for (const [key, cfg] of Object.entries(SLOT_CONFIG) as Array<[SlotKey, typeof SLOT_CONFIG.promo]>) {
  slotStates.set(key, {
    slot: key,
    label: cfg.label,
    framework: cfg.framework,
    port: cfg.port,
    url: '',
    turn: 0,
    status: 'loading',
    serverOnline: true
  });
}

function buildContextForSlot(slot: SlotKey, crashOnMount = false): AppContext {
  const cfg = SLOT_CONFIG[slot];
  return Object.freeze({
    user: { ...currentUser },
    locale: 'vi-VN',
    theme: currentTheme,
    apiBaseUrl: '/api',
    eventBus: createScopedBus(`${cfg.framework}`),
    navigate,
    getAccessToken,
    cart: cartForSession(),
    chaos: crashOnMount ? { crashOnMount: true } : undefined
  });
}

const OFFLINE_PORTS_KEY = 'shoplite_simulated_offline_ports_v1';
const DEMO_CART_EDITION_KEY = 'shoplite.demo.cart-edition.v1';

function getSimulatedOfflinePorts(): Set<number> {
  try {
    return new Set<number>(JSON.parse(sessionStorage.getItem(OFFLINE_PORTS_KEY) || '[]'));
  } catch {
    return new Set<number>();
  }
}

function saveSimulatedOfflinePorts(set: Set<number>) {
  try {
    sessionStorage.setItem(OFFLINE_PORTS_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // ignore
  }
}

async function fetchManifest(): Promise<RemoteManifest> {
  try {
    const res = await fetch(`/manifest.json?ts=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as RemoteManifest;
    const edition = isBrowserDemo ? sessionStorage.getItem(DEMO_CART_EDITION_KEY) : null;
    if (edition === 'v1' || edition === 'v2') {
      const versionsResponse = await fetch('/manifest-versions.json', { cache: 'no-store' });
      if (!versionsResponse.ok) throw new Error('Không tải được danh sách phiên bản demo.');
      const versions = await versionsResponse.json();
      const descriptor = versions.cart?.[edition];
      if (!descriptor || descriptor.contractMajor !== 1 || !descriptor.url?.startsWith('/remotes/cart/')) throw new Error('Phiên bản Cart demo không hợp lệ.');
      data.cart = descriptor;
    }

    currentManifest = data;
    const offlineSet = getSimulatedOfflinePorts();
    for (const slot of Object.keys(SLOT_CONFIG) as SlotKey[]) {
      const st = slotStates.get(slot);
      if (st && data[slot]) {
        st.serverOnline = !offlineSet.has(st.port);
        st.url = st.serverOnline ? data[slot].url : `/remotes/__offline_${st.port}__/entry.js`;
      }
    }
    const previewEl = document.getElementById('manifest-json-preview');
    if (previewEl) {
      previewEl.textContent = JSON.stringify(data, null, 2);
    }
    return data;
  } catch (err) {
    reportClient('LOAD_FAILED', 'catalog', err);
    throw err;
  }
}

async function syncServerStatuses() {
  if (isBrowserDemo) return;
  try {
    const res = await fetch('/__mfe_admin/status', { cache: 'no-store' });
    if (!res.ok) return;
    const statusData = await res.json();
    if (statusData?.ports) {
      for (const st of slotStates.values()) {
        st.serverOnline = Boolean(statusData.ports[st.port]);
      }
      renderChaosCards();
    }
  } catch {
    // Khi chạy vite dev đơn lẻ không có __mfe_admin thì bỏ qua
  }
}

function appendSystemLog(source: string, eventName: string, detail: any) {
  const stream = document.getElementById('event-log-stream');
  if (!stream) return;
  const row = document.createElement('div');
  row.className = 'sl-event-row';
  const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail);
  for (const [className, value] of [['sl-event-time', time], ['sl-event-src', source], ['sl-event-name', eventName], ['sl-event-payload', text]]) {
    const span = document.createElement('span'); span.className = className; span.textContent = value; row.appendChild(span);
  }
  stream.prepend(row);
  while (stream.children.length > 50) {
    stream.lastElementChild?.remove();
  }
}

function updateSlotMetaHeader(slot: SlotKey) {
  const st = slotStates.get(slot);
  const el = document.getElementById(`meta-${slot}`);
  if (!st || !el) return;
  const fileName = st.url.split('/').pop()?.split('?')[0] || 'entry.js';
  if (st.status === 'mounted') {
    el.textContent = `${fileName} | Lượt #${st.turn} (${st.loadTimeMs ?? 0}ms)`;
  } else if (st.status === 'loading') {
    el.textContent = `Đang tải lượt #${st.turn}...`;
  } else {
    el.textContent = `Fallback | Lượt #${st.turn}`;
  }
}

function renderChaosCards() {
  const grid = document.getElementById('chaos-slots-grid');
  if (!grid) return;

  grid.innerHTML = Array.from(slotStates.values())
    .map((st) => {
      const badgeClass =
        st.status === 'mounted'
          ? 'is-mounted'
          : st.status === 'loading'
            ? 'is-loading'
            : 'is-fallback';
      const statusText =
        st.status === 'mounted' ? 'ONLINE' : st.status === 'loading' ? 'LOADING' : 'FALLBACK';

      return `
        <div class="sl-chaos-card">
          <div class="sl-chaos-head">
            <strong>${st.framework} (:${st.port})</strong>
            <span class="sl-status-badge ${badgeClass}">${statusText} #${st.turn}</span>
          </div>
          <div class="sl-chaos-sub" title="${st.url}">${st.url}</div>
          <div class="sl-chaos-actions">
            <button type="button" class="sl-chaos-btn" data-chaos-op="reload" data-slot="${st.slot}">
              Nạp lại
            </button>
            <button type="button" class="sl-chaos-btn is-danger" data-chaos-op="timeout" data-slot="${st.slot}">
              Timeout 4.5s
            </button>
            <button type="button" class="sl-chaos-btn is-danger" data-chaos-op="crash" data-slot="${st.slot}">
              Lỗi mount()
            </button>
            <button type="button" class="sl-chaos-btn" data-chaos-op="race" data-slot="${st.slot}">
              Race (5 lượt)
            </button>
            <button
              type="button"
              class="sl-chaos-btn ${st.serverOnline ? '' : 'is-server-off'}"
              data-chaos-op="toggle-port"
              data-slot="${st.slot}"
            >
              ${st.serverOnline ? `Ngắt cổng :${st.port}` : `Bật lại cổng :${st.port}`}
            </button>
          </div>
        </div>
      `;
    })
    .join('');

  grid.querySelectorAll<HTMLButtonElement>('[data-chaos-op]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const slot = btn.dataset.slot as SlotKey;
      const op = btn.dataset.chaosOp;
      handleChaosOperation(slot, op || 'reload');
    });
  });
}

async function mountSlot(
  slot: SlotKey,
  opts: { forceNetworkBust?: boolean; delayMs?: number; crashOnMount?: boolean } = {}
) {
  const container = document.getElementById(`slot-${slot}`);
  const st = slotStates.get(slot);
  if (!container || !st) return;
  if (!slotIsVisible(slot) || sessionChanging) return;

  const ctx = buildContextForSlot(slot, Boolean(opts.crashOnMount));

  await loadRemote({
    slotName: slot,
    container,
    descriptor: { ...currentManifest[slot], url: st.url },
    ctx,
    supportedContractMajors,
    retry: async () => { await fetchManifest(); await mountSlot(slot, { forceNetworkBust: true }); },
    timeoutMs: 3000,
    forceNetworkBust: opts.forceNetworkBust,
    delayMs: opts.delayMs,
    onStateChange: (info) => {
      if (info.status === 'stale-discarded') {
        appendSystemLog(
          'Loader Guard',
          `discarded:${slot}#${info.turn}`,
          `Đã chặn lượt cũ #${info.turn} hoàn tất muộn sau ${info.loadTimeMs}ms (Chống ghi đè DOM!)`
        );
        return;
      }
      st.turn = info.turn;
      st.status = info.status;
      st.loadTimeMs = info.loadTimeMs;
      st.lastError = info.error;
      updateSlotMetaHeader(slot);
      renderChaosCards();

      if (info.status === 'fallback') {
        appendSystemLog('Fault Isolation', `fallback:${slot}#${info.turn}`, info.error || 'Lỗi');
      } else if (info.status === 'mounted') {
        appendSystemLog(
          'Runtime Loader',
          `mounted:${slot}#${info.turn}`,
          `Hoàn tất nạp sau ${info.loadTimeMs}ms`
        );
      }
    }
  });
}

async function handleChaosOperation(slot: SlotKey, op: string) {
  const st = slotStates.get(slot);
  if (!st) return;

  if (op === 'reload') {
    await mountSlot(slot, { forceNetworkBust: true });
  } else if (op === 'timeout') {
    // Bộ nạp dừng chờ sau 3000ms.
    await mountSlot(slot, { forceNetworkBust: true, delayMs: 4500 });
  } else if (op === 'crash') {
    // Mô phỏng lỗi ngay trong mount().
    await mountSlot(slot, { forceNetworkBust: true, crashOnMount: true });
  } else if (op === 'race') {
    // Chỉ lượt mới nhất được mount.
    const delays = [2100, 1500, 2400, 950, 180];
    appendSystemLog(
      'Chaos Lab',
      `race-test:${slot}`,
      `Bắn 5 lượt liên tiếp với độ trễ [${delays.join('ms, ')}ms] — Kỳ vọng chỉ lượt cuối thắng!`
    );
    delays.forEach((d) => {
      mountSlot(slot, { forceNetworkBust: true, delayMs: d });
    });
  } else if (op === 'toggle-port') {
    const nextAction = st.serverOnline ? 'stop' : 'start';
    if (isBrowserDemo) {
      const offlineSet = getSimulatedOfflinePorts();
      if (nextAction === 'stop') { offlineSet.add(st.port); st.serverOnline = false; st.url = `/remotes/__offline_${st.port}__/entry.js`; }
      else { offlineSet.delete(st.port); st.serverOnline = true; st.url = currentManifest[slot].url; }
      saveSimulatedOfflinePorts(offlineSet);
    } else try {
      const res = await fetch('/__mfe_admin/toggle-port', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: st.port, action: nextAction })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const result = await res.json();
      st.serverOnline = Boolean(result.online);
    } catch (error) {
      appendSystemLog('Server Admin', 'toggle-port-failed', String(error)); return;
    }

    renderChaosCards();
    appendSystemLog(
      'Server Admin',
      `port:${st.port}`,
      st.serverOnline
        ? `Đã khôi phục kết nối Remote :${st.port}`
        : `Đã NGẮT kết nối Remote :${st.port} (Mô phỏng sập server cục bộ)`
    );
    await mountSlot(slot, { forceNetworkBust: true });
  }
}

async function switchCartEdition(edition: 'v1' | 'v2') {
  const msgEl = document.getElementById('manifest-status-msg');
  let newCartUrl = '';
  if (isBrowserDemo) {
    const previous = sessionStorage.getItem(DEMO_CART_EDITION_KEY);
    try {
      sessionStorage.setItem(DEMO_CART_EDITION_KEY, edition);
      await fetchManifest(); await mountSlot('cart');
      if (msgEl) msgEl.textContent = `Đã chọn Cart ${edition} cho tab demo này. Giỏ hàng được giữ nguyên.`;
      appendSystemLog('Browser Demo', `preview:cart-${edition}`, currentManifest.cart.url);
    } catch (error) {
      if (previous) sessionStorage.setItem(DEMO_CART_EDITION_KEY, previous); else sessionStorage.removeItem(DEMO_CART_EDITION_KEY);
      if (msgEl) msgEl.textContent = `Không đổi được bản demo: ${String(error)}`;
    }
    return;
  }

  try {
    const res = await fetch('/__mfe_admin/deploy-cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edition })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(data.failures || data.error || 'Deploy API unavailable'));
    newCartUrl = data.cartUrl;
    await fetchManifest();
  } catch (error) {
    if (msgEl) msgEl.textContent = `Không phát hành được: ${String(error)}. Cần máy chủ có API deploy và gate.`;
    return;
  }

  await mountSlot('cart', { forceNetworkBust: false });

  const actionLabel = edition === 'v2' ? 'Deploy độc lập Cart v2.0' : 'Instant Rollback về Cart v1.0';
  if (msgEl) {
    msgEl.textContent = `${actionLabel} thành công. URL mới trong manifest.json: ${newCartUrl}`;
  }
  appendSystemLog('Manifest CD', edition === 'v2' ? 'deploy:cart-v2' : 'rollback:cart-v1', newCartUrl);
}

function setupShellInteractions() {
  // 1. Theo dõi EventBus toàn cục để hiển thị giỏ hàng trên Header & bảng Event Inspector
  const busIdEl = document.getElementById('bus-singleton-id');
  if (busIdEl) busIdEl.textContent = eventBus.instanceId;

  const fmtIdEl = document.getElementById('format-singleton-id');
  if (fmtIdEl) fmtIdEl.textContent = SHARED_FORMAT_VERSION;

  eventBus.on(
    'cart:updated',
    (payload) => {
      const countEl = document.getElementById('header-cart-count');
      const totalEl = document.getElementById('header-cart-total');
      if (countEl) countEl.textContent = String(payload?.totalQty ?? 0);
      if (totalEl) totalEl.textContent = formatVND(payload?.finalTotal ?? 0);
    },
    { replay: true }
  );

  eventBus.subscribeMonitor((entry) => {
    appendSystemLog(entry.source, entry.event, entry.payload);
  });

  // 2. Đổi giao diện Sáng / Tối qua CSS Custom Properties
  const themeBtn = document.getElementById('theme-toggle-btn');
  themeBtn?.addEventListener('click', () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    if (themeBtn) {
      themeBtn.textContent = currentTheme === 'light' ? 'Chế độ tối' : 'Chế độ sáng';
    }
    eventBus.emit('shell:theme-changed', { theme: currentTheme }, 'App Shell');
  });

  // 3. Đổi tài khoản người dùng tập trung ở App Shell (Quyết định 4: Auth tập trung)
  const userSelect = document.getElementById('user-switcher') as HTMLSelectElement | null;
  userSelect?.addEventListener('change', () => { void changeUser(userSelect.value.includes('Minh Anh') ? 'u1' : 'u2'); });
  document.getElementById('logout-btn')?.addEventListener('click', () => { void changeUser(null); });
  document.querySelectorAll<HTMLAnchorElement>('[data-route]').forEach(link => link.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); navigate(link.pathname + link.search);
  }));
  window.addEventListener('popstate', () => { void renderRoute(); });

  // 4. Bật/tắt bảng Phòng thí nghiệm MFE
  const labPanel = document.getElementById('mfe-lab-panel');
  const labBtn = document.getElementById('lab-toggle-btn');
  labBtn?.addEventListener('click', () => {
    labPanel?.classList.toggle('is-hidden');
  });

  // 5. Chuyển tab trong Phòng thí nghiệm MFE
  document.querySelectorAll<HTMLButtonElement>('[data-lab-tab]').forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      const target = tabBtn.dataset.labTab;
      document.querySelectorAll('.sl-lab-tab').forEach((b) => b.classList.remove('is-active'));
      document.querySelectorAll('.sl-lab-pane').forEach((p) => p.classList.remove('is-active'));
      tabBtn.classList.add('is-active');
      document.getElementById(`lab-pane-${target}`)?.classList.add('is-active');
    });
  });

  // 6. Nút Deploy Cart v2 & Instant Rollback Cart v1
  document.getElementById('btn-deploy-v2')?.addEventListener('click', () => switchCartEdition('v2'));
  document.getElementById('btn-rollback-v1')?.addEventListener('click', () => switchCartEdition('v1'));

  document.getElementById('btn-reset-demo')?.addEventListener('click', async () => {
    try { await cartForSession().resetStock(); } catch (error) { appendSystemLog('Cart API', 'reset-failed', String(error)); return; }
    eventBus.emit('warehouse:reset', {}, 'App Shell');
    appendSystemLog('App Shell', 'warehouse:reset', 'Đã khôi phục số lượng tồn kho ban đầu');
  });

  document.getElementById('btn-clear-logs')?.addEventListener('click', () => {
    const stream = document.getElementById('event-log-stream');
    if (stream) stream.innerHTML = '';
  });
}

async function bootstrapShell() {
  setupShellInteractions();
  if (isBrowserDemo) {
    document.getElementById('browser-demo-notice')!.hidden = false;
    document.getElementById('btn-deploy-v2')!.textContent = 'Thử Cart v2';
    document.getElementById('btn-rollback-v1')!.textContent = 'Về Cart v1';
    document.getElementById('manifest-help')!.textContent = 'Thử hai giao diện Cart trong tab này; giỏ hàng lưu riêng theo tài khoản trên trình duyệt.';
  }
  const metaResponse = await fetch('/shell-meta.json', { cache: 'no-store' });
  if (!metaResponse.ok) throw new Error('Missing shell metadata');
  supportedContractMajors = (await metaResponse.json()).supportedContractMajors;
  await fetchManifest();
  await syncServerStatuses();
  renderChaosCards();
  const user = await syncSession();
  currentUser = user || { id: 'guest', name: 'Khách', tier: 'Member' };
  if (location.pathname === '/') history.replaceState({}, '', '/products');
  await renderRoute();
}

function slotIsVisible(slot: SlotKey) {
  if (currentUser.id === 'guest') return false;
  return slot === 'promo' || (location.pathname === '/products' && (slot === 'catalog' || slot === 'reviews')) || (location.pathname === '/cart' && slot === 'cart');
}
function navigate(path: string) {
  const next = new URL(path, location.href);
  if (next.origin !== location.origin) return;
  history.pushState({}, '', next.pathname + next.search); void renderRoute();
}
async function renderRoute() {
  const turn = ++routeTurn;
  eventBus.emit('shell:route-changed', { path: location.pathname + location.search }, 'App Shell');
  const userSelect = document.getElementById('user-switcher') as HTMLSelectElement;
  userSelect.value = currentUser.id === 'guest' ? '' : currentUser.name;
  document.getElementById('login-notice')!.hidden = currentUser.id !== 'guest';
  const known = ['/products', '/cart'].includes(location.pathname);
  document.getElementById('route-not-found')!.hidden = known;
  const slots = Object.keys(SLOT_CONFIG) as SlotKey[];
  await Promise.all(slots.map(async slot => {
    const card = document.querySelector<HTMLElement>(`[data-slot-card="${slot}"]`)!;
    const visible = known && slotIsVisible(slot); card.hidden = !visible;
    // Invalidate before awaiting: a pending import cannot mount into a departed route.
    await unmountSlotIfMounted(slot);
  }));
  if (turn !== routeTurn) return;
  await Promise.all(slots.filter(slot => known && slotIsVisible(slot)).map(slot => mountSlot(slot)));
}
async function changeUser(userId: string | null) {
  if (sessionChanging) return;
  sessionChanging = true; ++routeTurn;
  const select = document.getElementById('user-switcher') as HTMLSelectElement; select.disabled = true;
  try {
    await Promise.all((Object.keys(SLOT_CONFIG) as SlotKey[]).map(slot => unmountSlotIfMounted(slot)));
    const user = await syncSession(userId);
    currentUser = user || { id: 'guest', name: 'Khách', tier: 'Member' };
    document.getElementById('event-log-stream')!.replaceChildren();
  } catch (error) { currentUser = { id: 'guest', name: 'Khách', tier: 'Member' }; reportClient('LOAD_FAILED', 'cart', error); }
  finally { sessionChanging = false; select.disabled = false; await renderRoute(); }
}
bootstrapShell().catch(error => {
  document.getElementById('login-notice')!.hidden = false;
  document.getElementById('login-notice')!.textContent = isBrowserDemo
    ? `Không tải được bản demo: ${String(error)}. Hãy tải lại trang và cho phép lưu dữ liệu của trang.`
    : `Không khởi tạo được ứng dụng: ${String(error)}. Chạy npm start để dùng API phiên và giỏ hàng.`;
});
