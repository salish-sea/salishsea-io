import { html, LitElement } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Task } from '@lit/task';
import {
  displayName, fetchAllGroups, fetchAnimalNames, fetchGroupMembers, fetchIndividual, fetchInnermostMatrilineId, fetchOccurrenceLinks,
  fetchOffspring, fetchParents, groupChain, individualPath, isPopulation, keyLabel, parseIndividualPath,
  type OccurrenceLink,
} from './catalog.ts';
import { canonicalize, profileStyles, renderProfileFrame } from './profile-shared.ts';
import {
  individualStyles, individualTitle, renderIndividualProfile, renderIndividualSightings,
  type IndividualProfileData,
} from './individual-profile.ts';
import { initSentry } from './sentry.ts';
import './individual-map.ts';

initSentry();

@customElement('individual-page')
export class IndividualPage extends LitElement {
  @state() private key = parseIndividualPath(window.location.pathname);

  #profile = new Task(this, {
    args: () => [this.key] as const,
    task: async ([key]): Promise<IndividualProfileData | null> => {
      if (!key) return null;
      const profile = await fetchIndividual(key);
      if (!profile) return null;
      canonicalize(individualPath(profile));
      const [{ mother, father }, offspring, groups, innermostId] = await Promise.all([
        fetchParents(profile),
        fetchOffspring(profile.id),
        fetchAllGroups(),
        fetchInnermostMatrilineId(profile.id),
      ]);
      const matriline = innermostId !== null ? groups.get(innermostId) ?? null : null;
      const members = matriline ? await fetchGroupMembers(matriline.id) : [];

      // The most specific name the register has for this animal. Its population, where the
      // group chain proves one — an ecotype or a community (decision 070) — else the
      // taxon the individual belongs to. Choosing between the two is ours (animals
      // ADR-0011); both strings are the register's, and neither is composed here. This
      // replaces a two-entry TAXON_LABELS table keyed on an iNaturalist taxon id, with
      // "Bigg's killer whale" hard-coded beside it — a name minted here for an animal the
      // register can name, which decision 033 forbids, and keyed on an iNaturalist taxon
      // id where 033 says "keyed on `SSA:`, never on a name".
      //
      // renderChain below still glosses a population by its designation (populationLabel:
      // "Bigg's (transient) killer whales"). That one is a gloss rather than a minted name —
      // it pairs the register's common name with its own `historical` name, which ADR-0011
      // hands us as display — but its key is still a string. Left alone here because
      // whether that line wants a gloss at all is a separate question (salish-53t.3).
      const ecotype = matriline
        ? groupChain(matriline.id, groups).find(isPopulation) ?? null
        : null;
      const names = await fetchAnimalNames([ecotype?.entity_id ?? null, profile.entity_id]);
      const species = (ecotype?.entity_id ? names.get(ecotype.entity_id)?.common_name : null)
        ?? (profile.entity_id ? names.get(profile.entity_id)?.taxon_common_name : null)
        ?? null;

      const name = displayName(profile.nicknames);
      document.title = `${individualTitle({ profile, name })} · SalishSea.io`;
      return { profile, mother, father, offspring, groups, matriline, members, name, species };
    },
  });

  // The slow half: identification links resolve live against sighting text
  // server-side (~2s). Runs after the profile so the masthead paints first.
  #sightings = new Task(this, {
    args: () => [this.#profile.value?.profile.id] as const,
    task: async ([individualId]): Promise<OccurrenceLink[] | null> =>
      individualId ? fetchOccurrenceLinks(individualId) : null,
  });

  static styles = [profileStyles, individualStyles];

  render() {
    return renderProfileFrame(html`
        ${this.#profile.render({
          pending: () => html`<p class="placeholder">Looking up ${this.key ? keyLabel(this.key) : 'this individual'}&hellip;</p>`,
          error: () => html`<p class="error">Something went wrong loading this page. Please try again.</p>`,
          complete: value => value
            ? renderIndividualProfile(value, this.renderSightings(value.profile.primary_designation))
            : this.renderNotFound(),
        })}
    `);
  }

  private renderNotFound() {
    const label = this.key ? keyLabel(this.key) : null;
    return html`
      <h1>${label ?? 'Not found'}</h1>
      <p>We don't have ${label ? html`<b>${label}</b>` : 'that individual'} in our catalog.
      So far it covers Bigg's (transient) and Southern Resident killer whales; other populations are on the way.</p>
      <p><a href="/">Explore the sightings map</a> or <a href="/about.html">read about this site</a>.</p>
    `;
  }

  // The section's content; the heading is the shared template's. Pending and error are
  // the live page's alone — a prerendered page has its links in hand.
  private renderSightings(designation: string) {
    return this.#sightings.render({
      pending: () => html`<p class="placeholder">Searching sighting reports&hellip; this takes a few seconds.</p>`,
      error: () => html`<p class="error">Couldn't load sightings just now.</p>`,
      complete: (links: OccurrenceLink[] | null) => renderIndividualSightings(designation, links),
    });
  }

}

declare global {
  interface HTMLElementTagNameMap {
    'individual-page': IndividualPage;
  }
}
