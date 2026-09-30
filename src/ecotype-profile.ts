/**
 * An ecotype's profile page, as templates that render anywhere (decision 057).
 *
 * As src/individual-profile.ts is for an individual: the client-rendered page
 * (src/ecotype-page.ts) fills these from Supabase, and the read-path build
 * (scripts/read-path/profiles.ts) from the snapshot. Nothing here touches the
 * window, the document, or the network.
 */

import { html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import {
  ecotypePath, matrilinePath,
  type EcotypeProfile, type OccurrenceLink, type SocialGroup,
} from './catalog.ts';
import { renderSightingsSummary, type SightingsOptions } from './profile-shared.ts';

// The catalog's one ecotype today; its notes column carries this descriptor but
// notes are never rendered (D-21), so the display label is set in code.
const ECOTYPE_LABELS: Record<string, string> = {
  Biggs: "Bigg's (transient) killer whales",
};

/** What the page shows of the group itself: never its `notes` (D-21). */
export type ProfileEcotype = Pick<EcotypeProfile, 'id' | 'entity_id' | 'designation'>;

export interface EcotypeProfileData {
  group: ProfileEcotype;
  matrilines: Pick<SocialGroup, 'id' | 'entity_id' | 'designation'>[];
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
    path: ecotypePath(group),
  };
}

/** The page's content, given its Sightings section's content. */
export function renderEcotypeProfile({ group, matrilines }: EcotypeProfileData, sightings: unknown) {
  const label = ecotypeLabel(group);
  return html`
    <header class="masthead">
      <div class="designation-kicker">Ecotype</div>
      <h1>${label}</h1>
      ${matrilines.length
        ? html`<p class="vitals">${matrilines.length} matrilines cataloged in the Salish Sea</p>`
        : nothing}
    </header>
    <section>
      <h2>Matrilines</h2>
      ${matrilines.length
        ? html`<ul class="people">
            ${repeat(matrilines, g => g.id, g =>
              html`<li><a href=${matrilinePath(g)}>${g.designation}</a></li>`)}
          </ul>`
        : html`<p class="placeholder">No matrilines cataloged yet.</p>`}
    </section>
    <section>
      <h2>Sightings</h2>
      <p class="sightings-note">Every report of any ${label.replace(/ killer whales$/, '')} member —
      each matriline and individual pooled together. Individual and matriline pages break this down by subject.</p>
      ${sightings}
    </section>
  `;
}

/** The Sightings section's content once the links are known. */
export function renderEcotypeSightings(links: OccurrenceLink[] | null, options: SightingsOptions = {}) {
  return renderSightingsSummary(links,
    html`<p class="placeholder">No sighting reports resolve to this ecotype yet.</p>`, options);
}
