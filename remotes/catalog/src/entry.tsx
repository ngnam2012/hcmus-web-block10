import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import App from './App';

export function mount(container: HTMLElement, ctx: any) {
  if (ctx?.chaos?.crashOnMount) {
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
