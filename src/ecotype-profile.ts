/**
 * An ecotype's profile page, as templates that render anywhere (decision 057).
 *
 * As src/individual-profile.ts is for an individual: the client-rendered page
 * (src/ecotype-page.ts) fills these from Supabase, and the read-path build
 * (scripts/read-path/profiles.ts) from the snapshot. Nothing here touches the
 * window, the document, or the network.
 */

import { css, html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import {
  populationPath, matrilinePath,
  type EcotypeProfile, type OccurrenceLink, type SocialGroup,
} from './catalog.ts';
import type { MapDot } from './individual-map.ts';
import { renderSightingsSummary, type SightingsOptions } from './profile-shared.ts';
import { renderSmallMaps, smallMapStyles } from './small-multiples.ts';

// The catalog's one ecotype today; its notes column carries this descriptor but
// notes are never rendered (D-21), so the display label is set in code.
const ECOTYPE_LABELS: Record<string, string> = {
  Biggs: "Bigg's (transient) killer whales",
};

/** The ecotype page's own styles, after profileStyles. */
export const ecotypeStyles = [smallMapStyles, css`
  .unreported {
    color: #475569;
    margin-top: 1.5rem;
  }
`];

/** What the page shows of the group itself: never its `notes` (D-21). */
export type ProfileEcotype = Pick<EcotypeProfile, 'id' | 'entity_id' | 'designation'>;

export interface EcotypeProfileData {
  group: ProfileEcotype;
  matrilines: Pick<SocialGroup, 'id' | 'entity_id' | 'designation'>[];
  /**
   * Each matriline's reports, by group id, as its own page has them: what its small map
   * draws (decision 067). The prerendered page has them; the client-rendered one, which
   * would need a request per matriline, doesn't, and lists the matrilines instead.
   */
  matrilineReports?: ReadonlyMap<number, readonly MapDot[]>;
}

/** What the page calls the ecotype, in its heading, its title and its preview. */
export function ecotypeLabel(group: Pick<ProfileEcotype, 'designation'>): string {
  return ECOTYPE_LABELS[group.designation] ?? group.designation;
}

/** What a link preview says about the page, as the Lambda@Edge function says it. */
export function ecotypePreview({ group }: Pick<EcotypeProfileData, 'group'>) {
  const label = ecotypeLabel(group);
  return {
    title: label,
    description: `The matrilines and aggregated sighting history of ${label} in the Salish Sea.`,
    path: populationPath(group),
  };
}

/** The page's content, given its Sightings section's content. */
export function renderEcotypeProfile({ group, matrilines, matrilineReports }: EcotypeProfileData, sightings: unknown) {
  const label = ecotypeLabel(group);
  const short = label.replace(/ killer whales$/, '');
  return html`
    <header class="masthead">
      <div class="designation-kicker">Ecotype</div>
      <h1>${label}</h1>
      ${matrilines.length
        ? html`<p class="vitals">${matrilines.length} matrilines cataloged in the Salish Sea</p>`
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
export function renderEcotypeSightings(links: OccurrenceLink[] | null, options: SightingsOptions = {}) {
  return renderSightingsSummary(links,
    html`<p class="placeholder">No sighting reports resolve to this ecotype yet.</p>`, options);
}
