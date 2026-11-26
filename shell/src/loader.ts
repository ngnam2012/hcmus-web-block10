import type { AppContext, MountedRemoteHandle, RemoteDescriptor, SlotKey } from './types';

type ErrorCode = 'LOAD_FAILED' | 'TIMEOUT' | 'MOUNT_ERROR' | 'INVALID_MODULE' | 'INCOMPATIBLE';
const turns = new Map<SlotKey, number>();
const handles = new Map<SlotKey, MountedRemoteHandle>();
const queues = new Map<SlotKey, Promise<unknown>>();
function serial<T>(slot: SlotKey, work: () => Promise<T>): Promise<T> {
  const next = (queues.get(slot) || Promise.resolve()).then(work, work);
  queues.set(slot, next.catch(() => {})); return next;
}
export function reportClient(code: string, slot: SlotKey, detail: unknown, turn?: number) {
  void fetch('/__log/client', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, slot, detail: String(detail), turn, route: location.pathname + location.search }), keepalive: true }).catch(() => {});
}
async function cleanup(slot: SlotKey) {
  const previous = handles.get(slot); handles.delete(slot);
  if (previous) await previous.unmount();
}
export async function unmountSlotIfMounted(slot: SlotKey) {
  turns.set(slot, (turns.get(slot) || 0) + 1);
  await serial(slot, async () => {
    try { await cleanup(slot); } catch (error) { reportClient('MOUNT_ERROR', slot, error); }
    document.getElementById(`slot-${slot}`)?.replaceChildren();
  });
}
export interface LoadRemoteOptions {
  slotName: SlotKey; container: HTMLElement; descriptor: RemoteDescriptor; ctx: AppContext;
  supportedContractMajors: number[]; retry: () => Promise<void>;
  timeoutMs?: number; forceNetworkBust?: boolean; delayMs?: number;
  onStateChange?: (info: { slot: SlotKey; turn: number; status: 'loading' | 'mounted' | 'fallback' | 'stale-discarded'; loadTimeMs?: number; error?: string; effectiveUrl: string }) => void;
}
class RemoteError extends Error { constructor(public code: ErrorCode, message: string) { super(message); } }
export async function loadRemote(options: LoadRemoteOptions) {
  const { slotName: slot, container, descriptor, ctx, onStateChange, timeoutMs = 3000 } = options;
  const turn = (turns.get(slot) || 0) + 1; turns.set(slot, turn);
  const started = performance.now();
  const current = () => turns.get(slot) === turn;
  const url = new URL(descriptor?.url || '/missing-entry.js', location.href);
  if (options.forceNetworkBust || options.delayMs) url.searchParams.set('attempt', `${turn}-${crypto.randomUUID()}`);
  if (options.delayMs) url.searchParams.set('delay', String(options.delayMs));
  const notify = (status: 'loading' | 'mounted' | 'fallback' | 'stale-discarded', error?: string) => onStateChange?.({ slot, turn, status, error, effectiveUrl: url.href, loadTimeMs: Math.round(performance.now() - started) });
  let lateReported = false, expired = false;
  const late = () => {
    if (lateReported) return; lateReported = true;
    reportClient('LATE_IGNORED', slot, url.href, turn); notify('stale-discarded', 'LATE_IGNORED');
  };
  try {
    await serial(slot, () => cleanup(slot));
    if (!current()) { late(); return; }
    const loading = document.createElement('div'); loading.className = 'sl-loading'; loading.textContent = `Đang nạp ${slot}...`;
    container.replaceChildren(loading); notify('loading');
    if (!descriptor || !options.supportedContractMajors.includes(descriptor.contractMajor)) throw new RemoteError('INCOMPATIBLE', 'Shell không hỗ trợ contract major của remote.');
    let timer: ReturnType<typeof setTimeout> | undefined;
    const modulePromise = import(/* @vite-ignore */ url.href);
    void modulePromise.then(() => { if (expired || !current()) late(); }, () => { if (expired || !current()) late(); });
    let mod: any;
    try {
      mod = await Promise.race([modulePromise, new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(new RemoteError('TIMEOUT', `Quá ${timeoutMs}ms`)); }, timeoutMs); })]);
    } catch (error) {
      if (error instanceof RemoteError) throw error;
      console.error('[Shell Loader] LOAD_FAILED', error);
      throw new RemoteError('LOAD_FAILED', String(error));
    } finally { clearTimeout(timer); }
    if (!current()) { late(); return; }
    if (typeof mod.mount !== 'function') throw new RemoteError('INVALID_MODULE', 'Remote thiếu mount(container, ctx).');
    await serial(slot, async () => {
      if (!current()) { late(); return; }
      const host = document.createElement('div'); host.dataset.remote = slot;
      const version = document.createElement('small'); version.dataset.release = slot; version.textContent = `${slot} ${mod.releaseVersion || descriptor.version}`;
      const style = document.createElement('style'); style.dataset.mfe = slot; style.textContent = mod.remoteStyles || '';
      const disposers: Array<() => void | Promise<void>> = [];
      const bus = { ...ctx.eventBus, on: (...args: Parameters<typeof ctx.eventBus.on>) => { const off = ctx.eventBus.on(...args); disposers.push(off); return off; } };
      const dispose = async () => {
        try { await Promise.allSettled(disposers.splice(0).map(off => Promise.resolve().then(off))); }
        finally { style.remove(); host.remove(); version.remove(); }
      };
      let handle: MountedRemoteHandle | undefined;
      try {
        container.replaceChildren(host); document.head.appendChild(style);
        handle = await mod.mount(host, { ...ctx, eventBus: bus, onCleanup: (fn: () => void | Promise<void>) => disposers.push(fn) });
        if (!handle || typeof handle.unmount !== 'function') throw new RemoteError('INVALID_MODULE', 'mount() thiếu unmount().');
        if (!current()) { await handle.unmount(); await dispose(); late(); return; }
        container.appendChild(version);
        handles.set(slot, { unmount: async () => { try { await handle!.unmount(); } finally { await dispose(); } } });
        notify('mounted');
      } catch (error) {
        try {
          if (typeof handle?.unmount === 'function') await handle.unmount();
        } catch (cleanupError) { reportClient('MOUNT_ERROR', slot, cleanupError, turn); }
        finally { await dispose(); }
        if (error instanceof RemoteError) throw error;
        throw new RemoteError('MOUNT_ERROR', String(error));
      }
    });
  } catch (error) {
    if (!current()) { late(); return; }
    const code = error instanceof RemoteError ? error.code : 'MOUNT_ERROR';
    const box = document.createElement('div'); box.className = 'sl-fallback'; box.setAttribute('role', 'alert'); box.dataset.errorCode = code;
    const message = document.createElement('p'); message.textContent = `${code}: ${error instanceof Error ? error.message : String(error)}`;
    const button = document.createElement('button'); button.type = 'button'; button.dataset.retry = slot; button.className = 'sl-retry-btn'; button.textContent = 'Thử tải lại';
    button.addEventListener('click', () => { void options.retry().catch(e => reportClient('LOAD_FAILED', slot, e)); });
    box.append(message, button); container.replaceChildren(box);
    reportClient(code, slot, error, turn); notify('fallback', `${code}: ${String(error)}`);
  }
}
