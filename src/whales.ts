/**
 * The whales page (salish-nkbq): every cetacean species we hold reports of, each with a
 * small map at one shared scale (decision 067). Templates that render anywhere: the
 * read-path build (scripts/read-path/whales.ts) fills them. Nothing here touches the
 * window, the document, or the network.
 */

import { css, html, nothing } from 'lit';
import { observedDate, mapUrl } from './catalog.ts';
import { formatDate } from './date-format.ts';
import type { MapDot } from './individual-map.ts';
import { renderSmallMap, renderSmallMapsCredit, smallMapStyles } from './small-multiples.ts';

export interface WhaleSpecies {
  /** The species' register identifier. */
  entity_id: string;
  common_name: string;
  scientific_name: string;
  /** Every report of the species or of anything beneath it (an ecotype), newest first. */
  reports: readonly MapDot[];
  /** Its ecotypes that have pages of their own. */
  ecotypes: readonly { href: string, label: string }[];
}

export interface WhalesData {
  /** Most-reported first. */
  species: readonly WhaleSpecies[];
  /** Reports of a cetacean identified only above species, such as "baleen whale". */
  unidentified: number;
}

export const WHALES_PATH = '/whales';

export function whalesPreview() {
  return {
    title: 'Whales',
    description: 'The whales, dolphins and porpoises reported in the Salish Sea, and where each has been seen.',
    path: WHALES_PATH,
  };
}

export const whalesStyles = [smallMapStyles, css`
  ol.species {
    list-style: none;
    margin: 2rem 0 0;
    padding: 0;
  }
  ol.species > li {
    display: grid;
    gap: 0 1.25rem;
    grid-template-columns: clamp(6.5rem, 30vw, 11rem) 1fr;
    margin-bottom: 2rem;
  }
  ol.species h2 {
    border: none;
    font-size: 1.375rem;
    letter-spacing: normal;
    margin: 0;
    padding: 0;
    text-transform: none;
  }
  .scientific {
    color: #64748b;
    font-style: italic;
    margin: 0 0 0.5rem;
  }
  .facts {
    color: #475569;
    margin: 0 0 0.375rem;
  }
  .unidentified {
    color: #64748b;
  }
`];

const plural = (n: number, one: string) => `${n.toLocaleString('en-US')} ${one}${n === 1 ? '' : 's'}`;

function renderSpecies({ common_name, scientific_name, reports, ecotypes }: WhaleSpecies) {
  const { map, shown } = renderSmallMap(reports, `${common_name.toLowerCase()}s`);
  const latest = reports[0];
  return html`<li>
    ${map}
    <div>
      <h2>${common_name}</h2>
      <p class="scientific">${scientific_name}</p>
      <p class="facts">${plural(reports.length, 'report')}${shown ? nothing : ', none in the area shown'}${latest
        ? html` · last reported <a href=${mapUrl(latest)}>${formatDate(observedDate(latest.observed_at), { month: 'long', day: 'numeric', year: 'numeric' })}</a>`
        : nothing}</p>
      ${ecotypes.length ? html`<p class="facts">Ecotypes: ${ecotypes.map((e, i) =>
        html`${i ? ' · ' : ''}<a href=${e.href}>${e.label}</a>`)}</p>` : nothing}
    </div>
  </li>`;
}

/** The page's content, after the nav. */
export function renderWhales({ species, unidentified }: WhalesData) {
  return html`
    <header class="masthead">
      <div class="designation-kicker">Species</div>
      <h1>Whales, dolphins and porpoises</h1>
      <p class="vitals">${species.length} species reported in the Salish Sea</p>
    </header>
    <p class="sightings-note">Every species of whale, dolphin and porpoise someone has reported
    to us, most-reported first. Each map shows the Salish Sea at the same scale; reports outside
    it aren't drawn. Killer whale reports come from their whole range, central California to
    northern British Columbia, and every other species' only from the Salish Sea and the Strait
    of Juan de Fuca. Reports cluster where people watch from, along shorelines and ferry routes,
    so compare the maps with each other rather than reading any one as a range. Most are
    unverified reports, not confirmed identifications.</p>
    <ol class="species">
      ${species.map(renderSpecies)}
    </ol>
    ${unidentified
      ? html`<p class="unidentified">${plural(unidentified, 'more report')} name a cetacean only
        as a group, such as “baleen whale” or “dolphin”, and aren't counted above.</p>`
      : nothing}
    ${renderSmallMapsCredit()}
  `;
}
