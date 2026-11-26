declare module '@shoplite/event-bus' {
  export interface EventHistoryEntry {
    id: number;
    time: string;
    event: string;
    source: string;
    payload: any;
  }

  export interface ScopedEventBus {
    instanceId: string;
    on: (event: string, handler: (payload: any) => void, options?: { replay?: boolean }) => () => void;
    off: (event: string, handler: (payload: any) => void) => void;
    emit: (event: string, payload?: any) => void;
    getLastPayload: <T = any>(event: string) => T | undefined;
  }

  export interface RootEventBus extends ScopedEventBus {
    emit: (event: string, payload?: any, source?: string) => void;
    subscribeMonitor: (fn: (entry: EventHistoryEntry) => void) => () => void;
    getHistory: () => EventHistoryEntry[];
    clearHistory: () => void;
    clearSession: () => void;
  }

  export const eventBus: RootEventBus;
  export function createScopedBus(sourceName: string): ScopedEventBus;
}

declare module '@shop/ds' { export const DS_VERSION: string; }

declare module '@shoplite/format' {
  export const SHARED_FORMAT_VERSION: string;
  export const FREESHIP_THRESHOLD: number;
  export const VIP_GIFT_THRESHOLD: number;
  export const BASE_SHIPPING_FEE: number;
  export const VAT_RATE: number;

  export function formatVND(amount: number): string;
  export function formatPercent(ratio: number): string;
  export function formatTimestamp(input?: string | number | Date): string;
  export function generateOrderCode(): string;
}
