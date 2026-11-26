class ShopLiteTechPill extends HTMLElement {
  static get observedAttributes() {
    return ['tech', 'port'];
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

    this.shadowRoot.innerHTML = `
      <style>
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 2px 8px;
          border-radius: 4px;
          font-family: var(--sl-font-sans, system-ui, sans-serif);
          font-size: 0.72rem;
          font-weight: 600;
          color: var(--sl-text-secondary, #334155);
          background: var(--sl-surface, #ffffff);
          border: 1px solid var(--sl-border, #cbd5e1);
          white-space: nowrap;
        }
        .port {
          color: var(--sl-text-secondary, #64748b);
          font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
          font-size: 0.69rem;
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
