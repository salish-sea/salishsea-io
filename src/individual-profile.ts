/**
 * An individual's profile page, as templates that render anywhere (decision 057).
 *
 * The same functions serve the client-rendered page (src/individual-page.ts, which
 * fetches the data from Supabase) and the build that prerenders every profile from
 * the read-path snapshot (scripts/read-path/profiles.ts, through @lit-labs/ssr). So
 * the page is written once: nothing here touches the window, the document, or the
 * network, and everything it shows arrives as data.
 */

import { css, html, nothing, type TemplateResult } from 'lit';
import { when } from 'lit/directives/when.js';
import { repeat } from 'lit/directives/repeat.js';
import {
  isPopulation, podLabel, podPath, populationLabel, populationPath, groupChain, individualPath, matrilinePath,
  type CatalogGroup, type GroupMember, type IndividualProfile, type OccurrenceLink, type Offspring, type Parent,
} from './catalog.ts';
import {
  renderDagger, renderMemberList, renderRelative, renderSightingsSummary, type SightingsOptions,
} from './profile-shared.ts';

const SCHEME_LABELS: Record<string, string> = {
  bc_wa: 'BC/WA',
  alaska: 'Alaska',
  california: 'California',
  other: '',
};

/**
 * What the page shows of the individual itself. Named column by column rather than
 * taken whole: the build never reads `notes`, verbatim Bigg's-sheet text rights policy
 * D-21 keeps off every page (decision 015), and this type says the page doesn't need it.
 */
export type ProfileIndividual = Pick<IndividualProfile,
  'id' | 'entity_id' | 'primary_designation' | 'sex' | 'born_earliest' | 'born_latest'
  | 'life_status' | 'maternity_certainty' | 'paternity_certainty' | 'designations' | 'nicknames'>;

export interface IndividualProfileData {
  profile: ProfileIndividual;
  mother: Parent | null;
  father: Parent | null;
  offspring: Offspring[];
  groups: Map<number, CatalogGroup>;
  matriline: CatalogGroup | null;
  members: GroupMember[];
  name: string | null;
  /**
   * What to call the animal, as the register calls it. `null` when the register knows
   * neither the ecotype nor the taxon, which renders as no species line rather than a guess.
   */
  species: string | null;
}

/** The page's title, as the tab and the link preview both show it. */
export function individualTitle({ profile, name }: Pick<IndividualProfileData, 'profile' | 'name'>): string {
  return name ? `${name} (${profile.primary_designation})` : profile.primary_designation;
}

export const individualStyles = css`
  dl.family {
    display: grid;
    gap: 0.375rem 1.5rem;
    grid-template-columns: max-content 1fr;
    margin: 0;
  }
  dl.family dt {
    color: #64748b;
  }
  dl.family dd {
    margin: 0;
  }
  h2 a {
    color: inherit;
  }
  h2 a:hover {
    color: #1976d2;
  }
  `;

function bornPhrase(earliest: number | null, latest: number | null): string | null {
  if (earliest !== null && latest !== null)
    return earliest === latest ? `born ${earliest}` : `born ${earliest}–${latest}`;
  if (latest !== null)
    return `born by ${latest}`;
  if (earliest !== null)
    return `born after ${earliest}`;
  return null;
}

function lifeStatusPhrase(status: ProfileIndividual['life_status']): string | null {
  switch (status) {
    case 'deceased': return 'deceased';
    case 'presumed_deceased': return 'presumed deceased';
    default: return null; // 'alive' is the unremarkable case; 'unknown' says nothing
  }
}

export function renderIndividualProfile(
  { profile, mother, father, offspring, groups, matriline, members, name, species }: IndividualProfileData,
  sightings: unknown,
) {
  const vitals = [
    profile.sex === 'female' ? 'Female' : profile.sex === 'male' ? 'Male' : null,
    bornPhrase(profile.born_earliest, profile.born_latest),
    lifeStatusPhrase(profile.life_status),
  ].filter(Boolean).join(' · ');
  const chain = matriline ? groupChain(matriline.id, groups) : [];

  return html`
    <header class="masthead">
      <div class="designation-kicker">${name ? profile.primary_designation : species ?? nothing}</div>
      <h1>${name ?? profile.primary_designation}</h1>
      ${vitals || (name && species) ? html`<p class="vitals">${when(name && species, () => html`${species} · `)}${vitals}</p>` : nothing}
      ${chain.length ? html`<p class="lineage">${renderChain(chain, profile.primary_designation)}</p>` : nothing}
    </header>
    ${renderNaming(profile)}
    ${renderFamily(profile, mother, father, offspring)}
    ${when(matriline && members.length > 1, () => renderMatriline(matriline!, members, groups, profile.id))}
    <section>
    <h2>Sightings</h2>
    ${sightings}
  </section>
  `;
}


export function renderChain(chain: CatalogGroup[], selfDesignation: string): TemplateResult {
  const [first, ...rest] = chain;
  const parents = rest.filter(g => !isPopulation(g));
  const population = rest.find(isPopulation);
  return html`
    <b>${first!.designation} ${first!.kind === 'matriline' ? 'matriline' : first!.kind}</b>${
      parents.map(g => html` · within ${g.kind === 'pod'
        ? html`<a href=${podPath(g)}>${podLabel(g)}</a>`
        : html`${g.anchor && g.designation !== selfDesignation
          ? html`<a href=${individualPath(g.anchor)}>${g.designation}</a>`
          : g.designation}${g.kind === 'matriline' ? "'s matriline" : ` ${g.kind}`}`}`)
    }${population ? html` · <a href=${populationPath(population)}>${populationLabel(population)}</a>` : nothing}
  `;
}

export function renderNaming(profile: ProfileIndividual) {
  // By code: an embed's rows come in no stated order (decision 057).
  const aliases = profile.designations
    .filter(d => d.code !== profile.primary_designation)
    .sort((a, b) => a.code.localeCompare(b.code));
  const nicknames = profile.nicknames.filter(n => n.status !== 'deprecated');
  if (!aliases.length && !nicknames.length) return nothing;
  return html`
    <section>
      <h2>Names</h2>
      ${repeat(nicknames, n => n.name, n => html`
        <article class="nickname">
          <p class="nickname-line">
            <b>${n.name}</b>
            ${n.status !== 'official' ? html`<span class="muted">(${n.status.replace('_', ' ')})</span>` : nothing}
            ${n.named_year || n.namer ? html`<span class="muted"> — named${n.named_year ? ` in ${n.named_year}` : ''}${n.namer ? html` by ${n.namer.url ? html`<a target="_blank" rel="noopener noreferrer" href=${n.namer.url}>${n.namer.name}</a>` : n.namer.name}` : ''}</span>` : nothing}
          </p>
        </article>
      `)}
      ${when(aliases.length, () => html`
        <p class="muted">Also cataloged as ${aliases.map((d, i) => html`${i ? ', ' : ''}<b>${d.code}</b>${SCHEME_LABELS[d.scheme] ? ` (${SCHEME_LABELS[d.scheme]})` : ''}${d.status === 'superseded' ? ' — superseded' : ''}`)}.</p>
      `)}
    </section>
  `;
}

export function renderFamily(profile: ProfileIndividual, mother: Parent | null, father: Parent | null, offspring: Offspring[]) {
  if (!mother && !father && !offspring.length) return nothing;
  const certainty = profile.maternity_certainty;
  return html`
    <section>
      <h2>Family</h2>
      <dl class="family">
        ${when(mother, () => html`
          <dt>Mother</dt>
          <dd>${renderRelative(mother!)}${certainty !== 'confirmed' ? html` <span class="muted">(${certainty})</span>` : nothing}</dd>
        `)}
        ${when(father, () => html`
          <dt>Father</dt>
          <dd>${renderRelative(father!)}${profile.paternity_certainty && profile.paternity_certainty !== 'confirmed' ? html` <span class="muted">(${profile.paternity_certainty})</span>` : nothing}</dd>
        `)}
        ${when(offspring.length, () => html`
          <dt>Offspring</dt>
          <dd>
            <ul class="people">
              ${repeat(offspring, calf => calf.id, calf => html`
                <li>${renderRelative(calf)}${calf.born_earliest ? html` <span class="muted">b.&thinsp;${calf.born_earliest}</span>` : nothing}${renderDagger(calf.life_status)}</li>
              `)}
            </ul>
          </dd>
        `)}
      </dl>
    </section>
  `;
}

export function renderMatriline(matriline: CatalogGroup, members: GroupMember[], groups: Map<number, CatalogGroup>, selfId: number) {
  return html`
    <section>
      <h2><a href=${matrilinePath(matriline)}>${matriline.designation} matriline</a></h2>
      ${renderMemberList(members, matriline.id, groups, selfId)}
    </section>
  `;
}

/** The Sightings section's content once the links are known. */
export function renderIndividualSightings(designation: string, links: OccurrenceLink[] | null, options: SightingsOptions = {}) {
  return renderSightingsSummary(links,
    html`<p class="placeholder">No sighting reports mention ${designation} yet.</p>`, options);
}

/**
 * What a link preview says about the page: the same title and description the
 * Lambda@Edge function computes for crawlers today, so a prerendered page previews
 * as the live one does.
 */
export function individualPreview({ profile, name }: Pick<IndividualProfileData, 'profile' | 'name'>) {
  const title = individualTitle({ profile, name });
  const vitals = [
    profile.sex === 'female' ? 'Female' : profile.sex === 'male' ? 'Male' : null,
    bornPhrase(profile.born_earliest, profile.born_latest),
  ].filter(Boolean).join(', ');
  return {
    title,
    description: `${vitals ? `${vitals} · ` : ''}Names, family, and sighting history of ${title} in the Salish Sea.`,
    path: individualPath(profile),
  };
}
