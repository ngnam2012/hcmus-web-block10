declare const __SHOPLITE_RUNTIME_MODE__: 'server' | 'browser-demo';
export const isBrowserDemo = __SHOPLITE_RUNTIME_MODE__ === 'browser-demo';

export function logDemoClient(entry: unknown) {
  try {
    const key = 'shoplite.demo.client-log.v1';
    const previous = JSON.parse(sessionStorage.getItem(key) || '[]');
    sessionStorage.setItem(key, JSON.stringify([...(Array.isArray(previous) ? previous : []), entry].slice(-100)));
  } catch { /* The on-screen fallback still reports the error if storage is disabled. */ }
}
