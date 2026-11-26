import type { AppContext, MountedRemoteHandle, RemoteModuleContract, SlotKey } from './types';

/**
 * Quyết định 7 — Ranh giới lỗi (Fault Isolation) ở tầng App Shell:
 * 1. Timeout bằng Promise.race (ngắt chờ nếu Remote phản hồi quá chậm)
 * 2. Fallback UI gọn gàng tại đúng vị trí slot + nút Thử lại (không sập trắng toàn trang)
 * 3. Mã lượt (Generation Token) chống Race Condition khi người dùng tải lại liên tiếp
 * 4. Tự động gọi unmount() của phiên bản trước để tránh rò rỉ bộ nhớ (Memory Leak)
 */

const slotTurns = new Map<SlotKey, number>();
const activeHandles = new Map<SlotKey, MountedRemoteHandle>();

export interface LoadRemoteOptions {
  slotName: SlotKey;
  container: HTMLElement;
  url: string;
  ctx: AppContext;
  timeoutMs?: number;
  forceNetworkBust?: boolean;
  delayMs?: number;
  onStateChange?: (info: {
    slot: SlotKey;
    turn: number;
    status: 'loading' | 'mounted' | 'fallback' | 'stale-discarded';
    loadTimeMs?: number;
    error?: string;
    effectiveUrl: string;
  }) => void;
}

function importWithTimeout(url: string, ms: number, clientDelayMs?: number): Promise<RemoteModuleContract> {
  // Trên môi trường CDN tĩnh (Vercel), server không tự ngâm ?delay= nên Loader chủ động mô phỏng độ trễ đường truyền
  const isStaticPath = url.startsWith('/');
  const modulePromise =
    isStaticPath && clientDelayMs && clientDelayMs > 0
      ? new Promise<RemoteModuleContract>((resolve, reject) => {
          setTimeout(() => {
            import(/* @vite-ignore */ url).then(resolve, reject);
          }, clientDelayMs);
        })
      : import(/* @vite-ignore */ url);

  return Promise.race([
    modulePromise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout sau ${ms}ms (Server phản hồi quá chậm)`)), ms)
    )
  ]);
}

function buildEffectiveUrl(rawUrl: string, turn: number, forceBust?: boolean, delayMs?: number): string {
  if (!forceBust && !delayMs) return rawUrl;
  const sep = rawUrl.includes('?') ? '&' : '?';
  const params: string[] = [];
  if (delayMs && delayMs > 0) params.push(`delay=${delayMs}`);
  params.push(`turn=${turn}_${Date.now()}`);
  return `${rawUrl}${sep}${params.join('&')}`;
}

export function unmountSlotIfMounted(slotName: SlotKey) {
  const prev = activeHandles.get(slotName);
  if (prev) {
    try {
      prev.unmount();
    } catch (err) {
      console.warn(`[Shell Loader] Lỗi khi dọn dẹp unmount() ở slot "${slotName}":`, err);
    }
    activeHandles.delete(slotName);
  }
}

export async function loadRemote(options: LoadRemoteOptions): Promise<MountedRemoteHandle | undefined> {
  const {
    slotName,
    container,
    url,
    ctx,
    timeoutMs = 3000,
    forceNetworkBust = false,
    delayMs,
    onStateChange
  } = options;

  const turn = (slotTurns.get(slotName) ?? 0) + 1;
  slotTurns.set(slotName, turn);

  // Dọn dẹp instance cũ trước khi nạp lượt mới
  unmountSlotIfMounted(slotName);

  const effectiveUrl = buildEffectiveUrl(url, turn, forceNetworkBust, delayMs);
  const startedAt = performance.now();

  container.innerHTML = `
    <div class="sl-loading">
      <div class="sl-spinner"></div>
      <div>
        <strong>Đang nạp module "${slotName}" (Lượt #${turn})...</strong>
        <div class="sl-loading-sub">${effectiveUrl}</div>
      </div>
    </div>
  `;

  onStateChange?.({
    slot: slotName,
    turn,
    status: 'loading',
    effectiveUrl
  });

  try {
    const mod = await importWithTimeout(effectiveUrl, timeoutMs, delayMs);

    // Kiểm tra Mã lượt (Generation Token): nếu đã có lượt mới hơn thì hủy bỏ kết quả cũ ngay!
    if (slotTurns.get(slotName) !== turn) {
      onStateChange?.({
        slot: slotName,
        turn,
        status: 'stale-discarded',
        loadTimeMs: Math.round(performance.now() - startedAt),
        effectiveUrl
      });
      return undefined;
    }

    if (typeof mod.mount !== 'function') {
      throw new Error('Vi phạm Contract: Remote không export hàm mount(container, ctx)');
    }

    container.innerHTML = '';
    const handle = mod.mount(container, ctx);

    if (!handle || typeof handle.unmount !== 'function') {
      throw new Error('Vi phạm Contract: hàm mount() phải trả về { unmount: () => void }');
    }

    activeHandles.set(slotName, handle);

    onStateChange?.({
      slot: slotName,
      turn,
      status: 'mounted',
      loadTimeMs: Math.round(performance.now() - startedAt),
      effectiveUrl
    });

    return handle;
  } catch (err: any) {
    // Nếu lượt này đã cũ thì không được phép ghi đè Fallback UI lên lượt mới
    if (slotTurns.get(slotName) !== turn) {
      onStateChange?.({
        slot: slotName,
        turn,
        status: 'stale-discarded',
        loadTimeMs: Math.round(performance.now() - startedAt),
        error: err?.message || String(err),
        effectiveUrl
      });
      return undefined;
    }

    const reason = err?.message || 'Không thể kết nối tới máy chủ Remote';

    container.innerHTML = `
      <div class="sl-fallback" role="alert">
        <div class="sl-fallback-icon">⚠️</div>
        <div class="sl-fallback-content">
          <strong>Module "${slotName}" tạm thời gián đoạn (Đã cô lập lỗi cục bộ)</strong>
          <p>${reason}</p>
          <small>Các thành phần khác trên trang vẫn hoạt động bình thường. URL: <code>${url}</code></small>
        </div>
        <button type="button" class="sl-retry-btn" data-retry="${slotName}">
          ↻ Thử tải lại
        </button>
      </div>
    `;

    container.querySelector('[data-retry]')?.addEventListener('click', () => {
      // Khi bấm Thử lại, xóa cờ crash mô phỏng để khôi phục bình thường
      const cleanCtx: AppContext = { ...ctx, chaos: undefined };
      loadRemote({
        slotName,
        container,
        url,
        ctx: cleanCtx,
        timeoutMs,
        forceNetworkBust: true,
        onStateChange
      });
    });

    onStateChange?.({
      slot: slotName,
      turn,
      status: 'fallback',
      loadTimeMs: Math.round(performance.now() - startedAt),
      error: reason,
      effectiveUrl
    });

    return undefined;
  }
}
