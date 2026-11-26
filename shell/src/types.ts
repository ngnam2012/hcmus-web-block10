import type { ScopedEventBus } from '@shoplite/event-bus';

export type SlotKey = 'promo' | 'catalog' | 'cart' | 'reviews';

export interface UserProfile {
  id: string;
  name: string;
  tier: 'VIP' | 'Member';
}

export interface AppContext {
  user: UserProfile;
  locale: 'vi-VN';
  theme: 'light' | 'dark';
  apiBaseUrl: string;
  eventBus: ScopedEventBus;
  navigate: (path: string) => void;
  getAccessToken: () => Promise<string>;
  cart: ReturnType<typeof import('./session').cartForSession>;
  onCleanup?: (callback: () => void | Promise<void>) => void;
  chaos?: {
    crashOnMount?: boolean;
  };
}

export interface MountedRemoteHandle {
  unmount: () => void | Promise<void>;
}

export interface RemoteModuleContract {
  mount: (container: HTMLElement, ctx: AppContext) => MountedRemoteHandle | Promise<MountedRemoteHandle>;
}

export interface RemoteDescriptor { url: string; version: string; contractMajor: number; }
export type RemoteManifest = Record<SlotKey, RemoteDescriptor>;

export interface SlotRuntimeState {
  slot: SlotKey;
  label: string;
  framework: string;
  port: number;
  url: string;
  turn: number;
  status: 'loading' | 'mounted' | 'fallback';
  lastError?: string;
  serverOnline: boolean;
  loadTimeMs?: number;
}
