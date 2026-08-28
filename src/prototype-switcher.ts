/**
 * PROTOTYPE — THROWAWAY. Floating variant switcher for the symbology prototype.
 *
 * Deliberately high-contrast and ugly so it never reads as part of the design
 * under evaluation. Renders nothing unless `?variant=` is present, and nothing
 * at all in a production build.
 */

import { LitElement, css, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { activeVariant, GROUPS, VARIANTS, type GroupKey, type VariantKey } from './prototype-symbology.ts';

@customElement('prototype-switcher')
export class PrototypeSwitcher extends LitElement {
  @state()
  private variant: VariantKey | null = activeVariant();

  static styles = css`
:host {
  position: fixed;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10000;
  font: 500 13px system-ui, sans-serif;
}
.bar {
  align-items: center;
  background: #111827;
  border-radius: 999px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.4);
  color: #f9fafb;
  display: flex;
  gap: 0.75rem;
  padding: 0.4rem 0.6rem;
}
button {
  background: #374151;
  border: 0;
  border-radius: 999px;
  color: #f9fafb;
  cursor: pointer;
  font: inherit;
  height: 1.9rem;
  width: 1.9rem;
}
button:hover { background: #4b5563; }
.label { min-width: 22rem; text-align: center; }
.gloss { color: #9ca3af; font-weight: 400; }
.legend {
  background: #111827;
  border-radius: 0.5rem;
  color: #f9fafb;
  display: flex;
  flex-wrap: wrap;
  gap: 0.1rem 0.9rem;
  justify-content: center;
  margin-bottom: 0.4rem;
  padding: 0.4rem 0.7rem;
}
.legend span { align-items: center; display: flex; gap: 0.3rem; }
.swatch { border-radius: 50%; height: 0.7rem; width: 0.7rem; }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('keydown', this.onKeydown);
  }

  disconnectedCallback(): void {
    window.removeEventListener('keydown', this.onKeydown);
    super.disconnectedCallback();
  }

  private onKeydown = (evt: KeyboardEvent) => {
    if (evt.key !== 'ArrowLeft' && evt.key !== 'ArrowRight')
      return;
    const el = evt.composedPath()[0] as HTMLElement | undefined;
    const tag = el?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable)
      return;
    this.cycle(evt.key === 'ArrowRight' ? 1 : -1);
  };

  private cycle(delta: number) {
    if (!this.variant)
      return;
    const idx = VARIANTS.findIndex(v => v.key === this.variant);
    const next = VARIANTS[(idx + delta + VARIANTS.length) % VARIANTS.length]!;
    const url = new URL(document.location.href);
    url.searchParams.set('variant', next.key);
    // Full reload: the OpenLayers layer styles are wired once at construction,
    // and a prototype is not worth making them reactive.
    document.location.href = url.toString();
  }

  render() {
    if (import.meta.env.PROD || !this.variant)
      return nothing;
    const current = VARIANTS.find(v => v.key === this.variant)!;
    const groups = Object.keys(GROUPS) as GroupKey[];
    return html`
      ${this.variant === 'C' ? html`
        <div class="legend">
          ${groups.map(g => html`
            <span><i class="swatch" style="background:${GROUPS[g].color}"></i>${GROUPS[g].label}</span>
          `)}
        </div>
      ` : nothing}
      <div class="bar">
        <button @click=${() => this.cycle(-1)} title="Previous variant">←</button>
        <div class="label">
          <strong>${current.key} — ${current.name}</strong>
          <div class="gloss">${current.gloss}</div>
        </div>
        <button @click=${() => this.cycle(1)} title="Next variant">→</button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'prototype-switcher': PrototypeSwitcher;
  }
}
