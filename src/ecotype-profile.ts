/**
 * A population's profile page, as templates that render anywhere (decision 057): an
 * ecotype's, as the Bigg's is, or a community's, as the Southern Residents' is (070).
 * A Southern Resident pod's page is the same page a level down: its matrilines and the
 * sightings of all of them, pooled (070's population › pod › matriline).
 *
 * As src/individual-profile.ts is for an individual: the read-path build fills these
 * from the snapshot (scripts/read-path/profiles.ts). Nothing here touches the window,
 * the document, or the network.
 */

import { css, html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import {
  podLabel, podPath, populationLabel, populationPath, matrilinePath,
  type EcotypeProfile, type OccurrenceLink, type SocialGroup,
} from './catalog.ts';
import type { MapDot } from './individual-map.ts';
import { renderSightingsSummary, type SightingsOptions } from './profile-shared.ts';
import { renderSmallMaps, smallMapStyles } from './small-multiples.ts';

/** The ecotype page's own styles, after profileStyles. */
export const ecotypeStyles = [smallMapStyles, css`
  .unreported {
    color: #475569;
    margin-top: 1.5rem;
  }
`];

/** What the page shows of the group itself: never its `notes` (D-21). */
export type ProfileEcotype = Pick<EcotypeProfile, 'id' | 'entity_id' | 'designation' | 'kind'>;

type GroupLink = Pick<SocialGroup, 'id' | 'entity_id' | 'designation'>;

export interface EcotypeProfileData {
  group: ProfileEcotype;
  matrilines: GroupLink[];
  /** A community's pods, each with a page (070). None for an ecotype or a pod. */
  pods?: GroupLink[];
  /** The population a pod belongs to, which its page links up to. */
  population?: Pick<SocialGroup, 'entity_id' | 'designation'> | null;
  /**
   * Each matriline's reports, by group id, as its own page has them: what its small map
   * draws (decision 067). Without them the page lists the matrilines by name.
   */
  matrilineReports?: ReadonlyMap<number, readonly MapDot[]>;
}

/** What the page calls the population or pod, in its heading, its title and its preview. */
export const ecotypeLabel = (group: Pick<ProfileEcotype, 'designation' | 'kind'>): string =>
  group.kind === 'pod' ? podLabel(group) : populationLabel(group);

const KICKERS: Record<string, string> = { ecotype: 'Ecotype', community: 'Community', pod: 'Pod' };

/** What a link preview says about the page, as the Lambda@Edge function says it. */
export function ecotypePreview({ group, population }: Pick<EcotypeProfileData, 'group' | 'population'>) {
  const label = ecotypeLabel(group);
  const of = population ? `${label} of ${populationLabel(population)}` : label;
  return {
    title: population ? `${label} · ${populationLabel(population)}` : label,
    description: `The matrilines and aggregated sighting history of ${of} in the Salish Sea.`,
    path: group.kind === 'pod' ? podPath(group) : populationPath(group),
  };
}

/** The page's content, given its Sightings section's content. */
export function renderEcotypeProfile({ group, matrilines, matrilineReports, pods, population }: EcotypeProfileData, sightings: unknown) {
  const label = ecotypeLabel(group);
  const short = label.replace(/ killer whales$/, '');
  return html`
    <header class="masthead">
      <div class="designation-kicker">${KICKERS[group.kind] ?? nothing}</div>
      <h1>${label}</h1>
      ${matrilines.length
        ? html`<p class="vitals">${matrilines.length} matrilines cataloged in the Salish Sea</p>`
        : nothing}
      ${population
        ? html`<p class="lineage"><a href=${populationPath(population)}>${populationLabel(population)}</a></p>`
        : nothing}
      ${pods?.length
        ? html`<p class="lineage">Pods: ${pods.map((p, i) => html`${i ? ' · ' : ''}<a href=${podPath(p)}>${podLabel(p)}</a>`)}</p>`
        : nothing}
    </header>
    <section>
      <h2>Sightings</h2>
      <p class="sightings-note">Every report of any ${short} member —
      each matriline and individual pooled together. ${matrilineReports
        ? 'The maps below break it down by matriline.'
        : 'Individual and matriline pages break this down by subject.'}</p>
      ${sightings}
    </section>
    <section>
      <h2>Matrilines</h2>
      ${!matrilines.length
        ? html`<p class="placeholder">No matrilines cataloged yet.</p>`
        : matrilineReports
          ? renderMatrilineMaps(matrilines, matrilineReports)
          : renderMatrilineList(matrilines)}
    </section>
  `;
}

type Matriline = EcotypeProfileData['matrilines'][number];

function renderMatrilineList(matrilines: readonly Matriline[]) {
  return html`<ul class="people">
    ${repeat(matrilines, g => g.id, g =>
      html`<li><a href=${matrilinePath(g)}>${g.designation}</a></li>`)}
  </ul>`;
}

/**
 * A small map per reported matriline, most-reported first, then the rest by name. Ties
 * keep the list's order, which is by designation, so the same data renders the same page.
 */
function renderMatrilineMaps(matrilines: readonly Matriline[], reports: ReadonlyMap<number, readonly MapDot[]>) {
  const reported = matrilines
    .map(g => ({ g, dots: reports.get(g.id) ?? [] }))
    .filter(({ dots }) => dots.length)
    .sort((a, b) => b.dots.length - a.dots.length);
  const unreported = matrilines.filter(g => !reports.get(g.id)?.length);
  return html`
    ${reported.length ? html`
      <p class="sightings-note">Where each matriline has been reported, every map at the same scale.
      A report that names two matrilines travelling together is on both of their maps. Reports cluster
      where people watch from, along shorelines and ferry routes, so compare the maps with each other
      rather than reading any one as a range. Reports outside the area shown aren't drawn.</p>
      ${renderSmallMaps(reported.map(({ g, dots }) => ({ href: matrilinePath(g), label: `${g.designation}s`, dots })))}
    ` : nothing}
    ${unreported.length ? html`
      <div class="unreported">${reported.length ? 'Not reported yet' : 'None reported yet'}:
        ${renderMatrilineList(unreported)}</div>
    ` : nothing}
  `;
}

/** The Sightings section's content once the links are known. */
export function renderEcotypeSightings(links: OccurrenceLink[] | null, options: SightingsOptions = {}, subject = 'population') {
  return renderSightingsSummary(links,
    html`<p class="placeholder">No sighting reports resolve to this ${subject} yet.</p>`, options);
}
