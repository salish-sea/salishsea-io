import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Task } from '@lit/task';
import {
  displayName, fetchAllGroups, fetchGroupMembers, fetchGroupOccurrenceLinks, fetchMatriline,
  keyLabel, matrilinePath, parseMatrilinePath,
  type OccurrenceLink,
} from './catalog.ts';
import { canonicalize, profileStyles, renderProfileFrame } from './profile-shared.ts';
import {
  matrilineTitle, renderMatrilineProfile, renderMatrilineSightings, type MatrilineProfileData,
} from './matriline-profile.ts';
import { initSentry } from './sentry.ts';
import './individual-map.ts';
import './site-search.ts';

initSentry();

@customElement('matriline-page')
export class MatrilinePage extends LitElement {
  @state() private key = parseMatrilinePath(window.location.pathname);

  #profile = new Task(this, {
    args: () => [this.key] as const,
    task: async ([key]): Promise<MatrilineProfileData | null> => {
      if (!key) return null;
      const group = await fetchMatriline(key);
      if (!group) return null;
      canonicalize(matrilinePath(group));
      const [members, groups] = await Promise.all([
        fetchGroupMembers(group.id),
        fetchAllGroups(),
      ]);
      const name = displayName(group.nicknames);
      document.title = `${matrilineTitle({ group, name })} · SalishSea.io`;
      return { group, groups, members, name };
    },
  });

  // The slow half runs after the profile so the masthead paints first
  // (individual-page precedent).
  #sightings = new Task(this, {
    args: () => [this.#profile.value?.group.id] as const,
    task: async ([groupId]): Promise<OccurrenceLink[] | null> =>
      groupId ? fetchGroupOccurrenceLinks(groupId) : null,
  });

  static styles = profileStyles;

  render() {
    return renderProfileFrame(html`
        ${this.#profile.render({
          pending: () => html`<p class="placeholder">Looking up ${this.key ? keyLabel(this.key) : 'this matriline'}&hellip;</p>`,
          error: () => html`<p class="error">Something went wrong loading this page. Please try again.</p>`,
          complete: value => value
            ? renderMatrilineProfile(value, this.renderSightings(value.group.designation))
            : this.renderNotFound(),
        })}
    `);
  }

  private renderNotFound() {
    const label = this.key ? keyLabel(this.key) : null;
    return html`
      <h1>${label ?? 'Not found'}</h1>
      <p>We don't have ${label ? html`a <b>${label}</b> matriline` : 'that matriline'} in our catalog.
      So far it covers Bigg's (transient) and Southern Resident killer whales; other populations are on the way.</p>
      <p><a href="/">Explore the sightings map</a> or <a href="/about.html">read about this site</a>.</p>
    `;
  }

  // The section's content; the heading is the shared template's. Pending and error are
  // the live page's alone — a prerendered page has its links in hand.
  private renderSightings(designation: string) {
    return this.#sightings.render({
      pending: () => html`<p class="placeholder">Searching sighting reports&hellip;</p>`,
      error: () => html`<p class="error">Couldn't load sightings just now.</p>`,
      complete: (links: OccurrenceLink[] | null) => renderMatrilineSightings(designation, links),
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'matriline-page': MatrilinePage;
  }
}
