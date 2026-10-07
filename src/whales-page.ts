/**
 * The whales page's shell, client-rendered (salish-nkbq). The page people see is the one
 * the read-path build prerenders into this shell (scripts/read-path/whales.ts), which
 * drops this script. The shell itself is served only before the first build has written
 * that page, and in development, so all it says is that the list isn't ready.
 */

import { html, LitElement } from 'lit';
import { customElement } from 'lit/decorators.js';
import { profileStyles, renderProfileFrame } from './profile-shared.ts';
import { whalesStyles } from './whales.ts';

@customElement('whales-page')
export class WhalesPage extends LitElement {
  static styles = [profileStyles, ...whalesStyles];

  render() {
    return renderProfileFrame(html`
      <h1>Whales, dolphins and porpoises</h1>
      <p class="placeholder">The list of species is built every few minutes from the latest
      reports, and isn't ready yet. Try again shortly, or <a href="/">explore the sightings map</a>.</p>
    `, 'whales');
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'whales-page': WhalesPage;
  }
}
