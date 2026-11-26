import { ensureReviewHubDefined, ShopLiteReviewHub } from './review-hub';

export function mount(container: HTMLElement, ctx: any) {
  if (ctx?.chaos?.crashOnMount) {
    throw new Error('[Web Components Reviews] Lỗi runtime mô phỏng bên trong mount()!');
  }

  ensureReviewHubDefined();
  const el = document.createElement('sl-review-hub') as ShopLiteReviewHub;
  container.appendChild(el);
  el.setContext(ctx);

  return {
    unmount: () => {
      el.remove();
    }
  };
}
