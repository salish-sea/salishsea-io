import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Task } from '@lit/task';
import {
  descendantMatrilines, ecotypePath, fetchAllGroups, fetchEcotype, fetchEcotypeOccurrenceLinks,
  keyLabel, parseEcotypePath,
  type OccurrenceLink,
} from './catalog.ts';
import { canonicalize, profileStyles, renderProfileFrame } from './profile-shared.ts';
import {
  ecotypeLabel, renderEcotypeProfile, renderEcotypeSightings, type EcotypeProfileData,
} from './ecotype-profile.ts';
import { initSentry } from './sentry.ts';
import './individual-map.ts';

initSentry();

@customElement('ecotype-page')
export class EcotypePage extends LitElement {
  @state() private key = parseEcotypePath(window.location.pathname);

  #profile = new Task(this, {
    args: () => [this.key] as const,
    task: async ([key]): Promise<EcotypeProfileData | null> => {
      if (!key) return null;
      const [group, groups] = await Promise.all([
        fetchEcotype(key),
        fetchAllGroups(),
      ]);
      if (!group) return null;
      canonicalize(ecotypePath(group));
      const matrilines = descendantMatrilines(group.id, groups);
      document.title = `${ecotypeLabel(group)} · SalishSea.io`;
      return { group, matrilines };
    },
  });

  // The slow half runs after the profile so the masthead paints first.
  #sightings = new Task(this, {
    args: () => [this.#profile.value?.group.id] as const,
    task: async ([ecotypeId]): Promise<OccurrenceLink[] | null> =>
      ecotypeId ? fetchEcotypeOccurrenceLinks(ecotypeId) : null,
  });

  static styles = profileStyles;

  render() {
    return renderProfileFrame(html`
        ${this.#profile.render({
          pending: () => html`<p class="placeholder">Looking up ${this.key ? keyLabel(this.key) : 'this ecotype'}&hellip;</p>`,
          error: () => html`<p class="error">Something went wrong loading this page. Please try again.</p>`,
          complete: value => value ? renderEcotypeProfile(value, this.renderSightings()) : this.renderNotFound(),
        })}
    `);
  }

  private renderNotFound() {
    const label = this.key ? keyLabel(this.key) : null;
    return html`
      <h1>${label ?? 'Not found'}</h1>
      <p>We don't have ${label ? html`a <b>${label}</b> ecotype` : 'that ecotype'} in our catalog.
      So far it covers Bigg's (transient) killer whales of the Salish Sea; other populations are on the way.</p>
      <p><a href="/">Explore the sightings map</a> or <a href="/about.html">read about this site</a>.</p>
    `;
  }

  // The section's content; the heading is the shared template's.
  private renderSightings() {
    return this.#sightings.render({
      pending: () => html`<p class="placeholder">Searching sighting reports&hellip;</p>`,
      error: () => html`<p class="error">Couldn't load sightings just now.</p>`,
      complete: (links: OccurrenceLink[] | null) => renderEcotypeSightings(links),
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ecotype-page': EcotypePage;
  }
}
