import React from 'react';
import '@shop/ds';
import '@shoplite/event-bus';
import '@shoplite/format';
import { createRoot, Root } from 'react-dom/client';
import App from './App';

export function mount(container: HTMLElement, ctx: any) {
  if (ctx?.chaos?.crashOnMount) {
    container.innerHTML = '<p data-partial>Catalog đang khởi tạo...</p>';
    throw new Error('[React Catalog] Lỗi runtime mô phỏng bên trong mount()!');
  }

  const root: Root = createRoot(container);
  root.render(<App ctx={ctx} />);

  return {
    unmount: () => {
      root.unmount();
    }
  };
}
