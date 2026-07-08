import { html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Task } from '@lit/task';
import { when } from 'lit/directives/when.js';
import { repeat } from 'lit/directives/repeat.js';
import {
  descendantMatrilines, fetchAllGroups, fetchEcotype, fetchEcotypeOccurrenceLinks,
  mapUrl, matrilinePath, observedDate, parseEcotypePath,
  type EcotypeProfile, type OccurrenceLink, type SocialGroup,
} from './catalog.ts';
import { profileStyles, renderPresenceTable } from './profile-shared.ts';
import { sentryClient } from './sentry.ts';
import './individual-map.ts';

sentryClient.init();

// The catalog's one ecotype today; its notes column carries this descriptor but
// notes are never rendered (D-21), so the display label is set in code.
const ECOTYPE_LABELS: Record<string, string> = {
  Biggs: "Bigg's (transient) killer whales",
};

interface Profile {
  group: EcotypeProfile;
  matrilines: SocialGroup[];
}

@customElement('ecotype-page')
export class EcotypePage extends LitElement {
  @state() private designation = parseEcotypePath(window.location.pathname);

  #profile = new Task(this, {
    args: () => [this.designation] as const,
    task: async ([designation]): Promise<Profile | null> => {
      if (!designation) return null;
      const [group, groups] = await Promise.all([
        fetchEcotype(designation),
        fetchAllGroups(),
      ]);
      if (!group) return null;
      const matrilines = descendantMatrilines(group.id, groups);
      document.title = `${ECOTYPE_LABELS[group.designation] ?? group.designation} · SalishSea.io`;
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
    return html`
      <main>
        <a class="back" href="/">&#8592; Back to the map</a>
        ${this.#profile.render({
          pending: () => html`<p class="placeholder">Looking up ${this.designation}&hellip;</p>`,
          error: () => html`<p class="error">Something went wrong loading this page. Please try again.</p>`,
          complete: value => value ? this.renderProfile(value) : this.renderNotFound(),
        })}
      </main>
    `;
  }

  private renderNotFound() {
    return html`
      <h1>${this.designation ?? 'Not found'}</h1>
      <p>We don't have ${this.designation ? html`a <b>${this.designation}</b> ecotype` : 'that ecotype'} in our catalog.
      So far it covers Bigg's (transient) killer whales of the Salish Sea; other populations are on the way.</p>
      <p><a href="/">Explore the sightings map</a> or <a href="/about.html">read about this site</a>.</p>
    `;
  }

  private renderProfile({ group, matrilines }: Profile) {
    const label = ECOTYPE_LABELS[group.designation] ?? group.designation;
    return html`
      <header class="masthead">
        <div class="designation-kicker">Ecotype</div>
        <h1>${label}</h1>
        ${matrilines.length
          ? html`<p class="vitals">${matrilines.length} matrilines cataloged in the Salish Sea</p>`
          : nothing}
      </header>
      ${this.renderDirectory(matrilines)}
      ${this.renderSightings(label)}
    `;
  }

  private renderDirectory(matrilines: SocialGroup[]) {
    return html`
      <section>
        <h2>Matrilines</h2>
        ${matrilines.length
          ? html`<ul class="people">
              ${repeat(matrilines, g => g.id, g =>
                html`<li><a href=${matrilinePath(g.designation)}>${g.designation}</a></li>`)}
            </ul>`
          : html`<p class="placeholder">No matrilines cataloged yet.</p>`}
      </section>
    `;
  }

  private renderSightings(label: string) {
    return html`
      <section>
        <h2>Sightings</h2>
        <p class="sightings-note">Every report of any ${label.replace(/ killer whales$/, '')} member —
        each matriline and individual pooled together. Individual and matriline pages break this down by subject.</p>
        ${this.#sightings.render({
          pending: () => html`<p class="placeholder">Searching sighting reports&hellip;</p>`,
          error: () => html`<p class="error">Couldn't load sightings just now.</p>`,
          complete: links => {
            if (!links?.length)
              return html`<p class="placeholder">No sighting reports resolve to this ecotype yet.</p>`;
            const latest = links[0]!;
            const located = links.filter(l => l.location).length;
            return html`
              ${renderPresenceTable(links)}
              ${when(located, () => html`<individual-map .links=${links}></individual-map>`)}
              <p class="sightings-note">
                Last reported <a href=${mapUrl(latest)}>${observedDate(latest.observed_at).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</a>
                · ${links.length} report${links.length === 1 ? '' : 's'} in all${when(located, () => html` — ${located === links.length ? 'each' : `${located} of them`} a dot above; the newest located report is solid. Click one to see that day on the map.`)}
              </p>
            `;
          },
        })}
      </section>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ecotype-page': EcotypePage;
  }
}
