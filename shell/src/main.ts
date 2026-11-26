import { createScopedBus, eventBus } from '@shoplite/event-bus';
import { SHARED_FORMAT_VERSION, formatVND } from '@shoplite/format';
import { loadRemote } from './loader';
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

let currentManifest: RemoteManifest = {
  promo: 'http://localhost:3003/entry.js',
  catalog: 'http://localhost:3001/entry.js',
  cart: 'http://localhost:3002/entry.js',
  reviews: 'http://localhost:3004/entry.js'
};

let currentTheme: 'light' | 'dark' = 'light';
let currentUser: UserProfile = {
  id: 'u-vip-01',
  name: 'Nguyễn Minh Anh',
  tier: 'VIP'
};

const slotStates = new Map<SlotKey, SlotRuntimeState>();
for (const [key, cfg] of Object.entries(SLOT_CONFIG) as Array<[SlotKey, typeof SLOT_CONFIG.promo]>) {
  slotStates.set(key, {
    slot: key,
    label: cfg.label,
    framework: cfg.framework,
    port: cfg.port,
    url: currentManifest[key],
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
    apiBaseUrl: 'http://localhost:3000/api',
    eventBus: createScopedBus(`${cfg.framework}`),
    navigate: (path: string) => {
      window.history.pushState({}, '', path);
      eventBus.emit('shell:route-changed', { path }, 'App Shell');
    },
    getAccessToken: async () => {
      const slug = currentUser.name.toLowerCase().replace(/\s+/g, '_');
      return `sl_jwt_${slug}_${Date.now().toString(36)}`;
    },
    chaos: crashOnMount ? { crashOnMount: true } : undefined
  });
}

const MANIFEST_OVERRIDE_KEY = 'shoplite_manifest_cart_override_v1';
const OFFLINE_PORTS_KEY = 'shoplite_simulated_offline_ports_v1';

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

    // Trên Vercel (không có ổ đĩa ghi đè manifest), đọc bản override deploy/rollback từ sessionStorage
    const cartOverride = sessionStorage.getItem(MANIFEST_OVERRIDE_KEY);
    if (cartOverride && data.cart.startsWith('/')) {
      data.cart = cartOverride;
    }

    currentManifest = data;
    const offlineSet = getSimulatedOfflinePorts();
    for (const slot of Object.keys(SLOT_CONFIG) as SlotKey[]) {
      const st = slotStates.get(slot);
      if (st && data[slot]) {
        st.serverOnline = !offlineSet.has(st.port);
        st.url = st.serverOnline ? data[slot] : `/remotes/__offline_${st.port}__/entry.js`;
      }
    }
    const previewEl = document.getElementById('manifest-json-preview');
    if (previewEl) {
      previewEl.textContent = JSON.stringify(data, null, 2);
    }
    return data;
  } catch (err) {
    console.warn('[App Shell] Không đọc được /manifest.json, dùng fallback localhost ports:', err);
    return currentManifest;
  }
}

async function syncServerStatuses() {
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
  row.innerHTML = `
    <span class="sl-event-time">${time}</span>
    <span class="sl-event-src">${source}</span>
    <span class="sl-event-name">${eventName}</span>
    <span class="sl-event-payload">${text}</span>
  `;
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
    el.textContent = `✓ ${fileName} • Lượt #${st.turn} (${st.loadTimeMs ?? 0}ms)`;
  } else if (st.status === 'loading') {
    el.textContent = `⏳ Đang tải Lượt #${st.turn}...`;
  } else {
    el.textContent = `⚠️ Fallback • Lượt #${st.turn}`;
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
        st.status === 'mounted' ? 'MOUNTED' : st.status === 'loading' ? 'LOADING' : 'FALLBACK';

      return `
        <div class="sl-chaos-card">
          <div class="sl-chaos-head">
            <strong>${st.framework} (:${st.port})</strong>
            <span class="sl-status-badge ${badgeClass}">${statusText} • #${st.turn}</span>
          </div>
          <div class="sl-chaos-sub" title="${st.url}">${st.url}</div>
          <div class="sl-chaos-actions">
            <button type="button" class="sl-chaos-btn" data-chaos-op="reload" data-slot="${st.slot}">
              ↻ Nạp chuẩn
            </button>
            <button type="button" class="sl-chaos-btn is-danger" data-chaos-op="timeout" data-slot="${st.slot}">
              ⏱️ F4: Timeout 4.5s
            </button>
            <button type="button" class="sl-chaos-btn is-danger" data-chaos-op="crash" data-slot="${st.slot}">
              💥 F5: Lỗi mount()
            </button>
            <button type="button" class="sl-chaos-btn" data-chaos-op="race" data-slot="${st.slot}">
              🏁 F6: Race (5 lượt)
            </button>
            <button
              type="button"
              class="sl-chaos-btn ${st.serverOnline ? '' : 'is-server-off'}"
              data-chaos-op="toggle-port"
              data-slot="${st.slot}"
            >
              ${st.serverOnline ? `🔌 F3: Tắt cổng :${st.port}` : `⚡ Bật lại cổng :${st.port}`}
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

  const ctx = buildContextForSlot(slot, Boolean(opts.crashOnMount));

  await loadRemote({
    slotName: slot,
    container,
    url: st.url,
    ctx,
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
    // Gửi tham số delay=4500ms trong khi ngưỡng Timeout của Shell là 3000ms (Kịch bản F4)
    await mountSlot(slot, { forceNetworkBust: true, delayMs: 4500 });
  } else if (op === 'crash') {
    // Mô phỏng ném Exception ngay bên trong hàm mount() của Remote (Kịch bản F5)
    await mountSlot(slot, { forceNetworkBust: true, crashOnMount: true });
  } else if (op === 'race') {
    // Kịch bản F6: Phát liên tiếp 5 lượt nạp với độ trễ đảo ngược để chứng minh chỉ Lượt cuối cùng được mount
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
    try {
      const res = await fetch('/__mfe_admin/toggle-port', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port: st.port, action: nextAction })
      });
      if (!res.ok) throw new Error('Static CDN mode');
      const result = await res.json();
      st.serverOnline = Boolean(result.online);
    } catch {
      // Tương thích hoàn toàn khi chạy trên 1 project Vercel tĩnh: cô lập đường dẫn Remote đó sang URL offline
      const offlineSet = getSimulatedOfflinePorts();
      if (nextAction === 'stop') {
        offlineSet.add(st.port);
        st.serverOnline = false;
        st.url = `/remotes/__offline_${st.port}__/entry.js`;
      } else {
        offlineSet.delete(st.port);
        st.serverOnline = true;
        st.url = currentManifest[slot];
      }
      saveSimulatedOfflinePorts(offlineSet);
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

  try {
    const res = await fetch('/__mfe_admin/deploy-cart', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ edition })
    });
    if (!res.ok) throw new Error('Static CDN mode');
    const data = await res.json();
    newCartUrl = data.cartUrl;
    sessionStorage.removeItem(MANIFEST_OVERRIDE_KEY);
    await fetchManifest();
  } catch {
    // Trên Vercel tĩnh: đọc manifest-versions.json chứa sẵn cả 2 bản băm bất biến v1 & v2 trên CDN
    const verRes = await fetch(`/manifest-versions.json?ts=${Date.now()}`, { cache: 'no-store' });
    const verData = await verRes.json();
    newCartUrl = verData.cart[edition];
    sessionStorage.setItem(MANIFEST_OVERRIDE_KEY, newCartUrl);
    await fetchManifest();
  }

  await mountSlot('cart', { forceNetworkBust: false });

  const actionLabel = edition === 'v2' ? 'Deploy độc lập Cart v2.0' : 'Instant Rollback về Cart v1.0';
  if (msgEl) {
    msgEl.textContent = `✓ ${actionLabel} thành công! URL mới trong manifest.json: ${newCartUrl} (Giỏ hàng vẫn giữ nguyên dữ liệu, bấm F5 cũng nhận bản ${edition}!)`;
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

  // 2. Đổi giao diện Sáng / Tối qua CSS Custom Properties (tự động lan tới cả 4 công nghệ & Shadow DOM)
  const themeBtn = document.getElementById('theme-toggle-btn');
  themeBtn?.addEventListener('click', () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    if (themeBtn) {
      themeBtn.textContent = currentTheme === 'light' ? '🌙 Giao diện Tối' : '☀️ Giao diện Sáng';
    }
    eventBus.emit('shell:theme-changed', { theme: currentTheme }, 'App Shell');
  });

  // 3. Đổi tài khoản người dùng tập trung ở App Shell (Quyết định 4: Auth tập trung)
  const userSelect = document.getElementById('user-switcher') as HTMLSelectElement | null;
  userSelect?.addEventListener('change', () => {
    const name = userSelect.value;
    currentUser = {
      id: name.includes('Minh Anh') ? 'u-vip-01' : 'u-mem-02',
      name,
      tier: name.includes('Minh Anh') ? 'VIP' : 'Member'
    };
    eventBus.emit('shell:user-changed', currentUser, 'App Shell');
    // Mount lại Reviews & Cart với ngữ cảnh user mới mượt mà
    mountSlot('reviews');
    mountSlot('cart');
  });

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

  document.getElementById('btn-reset-demo')?.addEventListener('click', () => {
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
  await fetchManifest();
  await syncServerStatuses();
  renderChaosCards();

  // Khởi chạy đồng thời cả 4 Remote thuộc 4 công nghệ khác nhau trên cùng một màn hình
  await Promise.all([
    mountSlot('promo'),
    mountSlot('catalog'),
    mountSlot('cart'),
    mountSlot('reviews')
  ]);
}

bootstrapShell();
