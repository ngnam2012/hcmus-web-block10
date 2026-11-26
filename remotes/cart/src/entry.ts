import { createApp, App as VueApp } from 'vue';
import '@shop/ds';
import '@shoplite/event-bus';
import '@shoplite/format';
import App from './App.vue';

const EDITION = (import.meta as any).env?.VITE_CART_EDITION || 'v1';

export const remoteMeta = {
  name: 'cart',
  framework: 'Vue 3',
  edition: EDITION
};

export function mount(container: HTMLElement, ctx: any) {
  if (ctx?.chaos?.crashOnMount) {
    throw new Error(`[Vue Cart ${EDITION}] Lỗi runtime mô phỏng bên trong mount()!`);
  }

  const app: VueApp = createApp(App, { ctx, edition: EDITION });
  app.mount(container);

  return {
    unmount: () => {
      app.unmount();
    }
  };
}
