/**
 * Tầng 2 của Design System (Phần 4): UI Primitive viết bằng Web Component chuẩn trình duyệt
 * dùng để hiển thị nhãn công nghệ và cổng của từng mảnh Micro Frontend.
 */
class ShopLiteTechPill extends HTMLElement {
  static get observedAttributes() {
    return ['tech', 'port', 'color'];
  }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    this.render();
  }

  render() {
    if (!this.shadowRoot) return;
    const tech = this.getAttribute('tech') || 'Remote';
    const port = this.getAttribute('port') || '';
    const color = this.getAttribute('color') || '#2563eb';

    this.shadowRoot.innerHTML = `
      <style>
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 3px 9px;
          border-radius: 999px;
          font-family: var(--sl-font-sans, system-ui, sans-serif);
          font-size: 0.72rem;
          font-weight: 800;
          color: #ffffff;
          background: ${color};
          letter-spacing: 0.01em;
          white-space: nowrap;
        }
        .port {
          padding: 1px 5px;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.22);
          font-family: monospace;
          font-size: 0.68rem;
        }
      </style>
      <span class="pill">
        <span>${tech}</span>
        ${port ? `<span class="port">:${port}</span>` : ''}
      </span>
    `;
  }
}

export function registerDesignSystemPrimitives() {
  if (!customElements.get('sl-tech-pill')) {
    customElements.define('sl-tech-pill', ShopLiteTechPill);
  }
}
