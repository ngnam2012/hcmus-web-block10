/**
 * @shoplite/event-bus (v1)
 * Thư viện giao tiếp sự kiện trung lập công nghệ dùng chung qua <script type="importmap">.
 * Đảm bảo đúng 1 singleton duy nhất giữa Shell, React, Vue, Svelte và Web Components.
 */

const INSTANCE_KEY = '__SHOPLITE_EVENT_BUS_SINGLETON_V1__';

class ShopLiteEventBus {
  constructor() {
    this.instanceId = `bus-${Math.random().toString(36).slice(2, 8)}`;
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
    /** @type {Map<string, any>} */
    this.lastPayloads = new Map();
    /** @type {Array<{ id: number, time: string, event: string, source: string, payload: any }>} */
    this.history = [];
    this.seq = 0;
    /** @type {Set<Function>} */
    this.monitors = new Set();
  }

  /**
   * Đăng ký lắng nghe sự kiện. Trả về hàm hủy đăng ký (unsubscribe) để gọi trong unmount().
   * @param {string} event
   * @param {(payload: any) => void} handler
   * @param {{ replay?: boolean }} [options]
   */
  on(event, handler, options = {}) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);

    if (options.replay && this.lastPayloads.has(event)) {
      try {
        handler(this.lastPayloads.get(event));
      } catch (err) {
        console.error(`[EventBus] Replay handler error on "${event}":`, err);
      }
    }

    return () => this.off(event, handler);
  }

  /**
   * Hủy đăng ký handler
   * @param {string} event
   * @param {Function} handler
   */
  off(event, handler) {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(handler);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }

  /**
   * Phát sự kiện tới mọi Remote đang lắng nghe
   * @param {string} event
   * @param {any} payload
   * @param {string} [source]
   */
  emit(event, payload, source = 'unknown') {
    this.lastPayloads.set(event, payload);

    const entry = {
      id: ++this.seq,
      time: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
      event,
      source: payload?.__source || source,
      payload
    };

    this.history.unshift(entry);
    if (this.history.length > 60) {
      this.history.pop();
    }

    const set = this.listeners.get(event);
    if (set) {
      for (const handler of Array.from(set)) {
        try {
          handler(payload);
        } catch (err) {
          console.error(`[EventBus] Listener error for "${event}":`, err);
        }
      }
    }

    for (const monitor of Array.from(this.monitors)) {
      try {
        monitor(entry);
      } catch (err) {
        console.error('[EventBus] Monitor error:', err);
      }
    }
  }

  /**
   * Đọc trạng thái gần nhất của một sự kiện (hữu ích khi Remote tải trễ hoặc vừa Retry)
   * @param {string} event
   */
  getLastPayload(event) {
    return this.lastPayloads.get(event);
  }

  /**
   * Dành cho công cụ Event Inspector của App Shell
   * @param {(entry: any) => void} fn
   */
  subscribeMonitor(fn) {
    this.monitors.add(fn);
    return () => this.monitors.delete(fn);
  }

  getHistory() {
    return [...this.history];
  }

  clearHistory() {
    this.history = [];
  }
}

export const eventBus =
  globalThis[INSTANCE_KEY] || (globalThis[INSTANCE_KEY] = new ShopLiteEventBus());

export function createScopedBus(sourceName) {
  return {
    instanceId: eventBus.instanceId,
    on: (event, handler, options) => eventBus.on(event, handler, options),
    off: (event, handler) => eventBus.off(event, handler),
    emit: (event, payload = {}) => eventBus.emit(event, payload, sourceName),
    getLastPayload: (event) => eventBus.getLastPayload(event)
  };
}
