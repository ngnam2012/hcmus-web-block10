import App from './App.svelte';
import '@shop/ds';
import '@shoplite/event-bus';
import '@shoplite/format';

export function mount(container, ctx) {
  if (ctx?.chaos?.crashOnMount) {
    throw new Error('[Svelte Promo] Lỗi runtime mô phỏng bên trong mount()!');
  }

  const app = new App({
    target: container,
    props: { ctx }
  });

  return {
    unmount: () => {
      app.$destroy();
    }
  };
}
