export const DS_VERSION = '1.0.0';
if (!customElements.get('ds-button')) customElements.define('ds-button', class extends HTMLElement {
  connectedCallback() { this.setAttribute('data-ds-version', DS_VERSION); }
});
