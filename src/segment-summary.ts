import { css, html, LitElement, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { classMap } from 'lit/directives/class-map.js';
import { Temporal } from 'temporal-polyfill';
import { linkStyles } from './icons.ts';
import { catalogCodes, loadCatalogCodes, matrilineCodes, podCodes, pooledAnimals, populationCodes } from './individual-links.ts';
import { isUnconfirmed } from './occurrence.ts';
import { segmentMovement, type SegmentMovement } from './segments.ts';
import { displayNameFor, GROUPS, taxonGroup } from './symbology.ts';
import type { Occurrence } from './types.ts';
import { sightingText } from './obs-summary.ts';
import './obs-summary.ts';

/** A segment becomes one card from this many reports up; fewer stay cards of their own (Peter, 2026-10-28). */
export const SEGMENT_CARD_MIN = 3;

/**
 * One card for a travel segment in the day's list (salish-fwyt.5): the reports the map
 * joins into one track (src/segments.ts, decision 063), summarized. It names the animals
 * the reports name, each with how many name it; says how far they moved; quotes the
 * latest report; and shows the segment's photos and sources. "Show all" opens the
 * reports' own cards, newest first, and a dot on the map that belongs to the segment
 * opens it at that report's card.
 *
 * Presentation only: behaviour from the reports' words (salish-2ua9), whether they
 * travelled or stayed (salish-jdl2) and marks of reliability (salish-0420) wait.
 */
@customElement('segment-summary')
export class SegmentSummary extends LitElement {
  static styles = [linkStyles, css`
    :host {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      display: block;
      font-size: var(--fs-body2);
      line-height: 1.5;
      padding: 0.625rem 0.75rem;
    }
    header {
      align-items: baseline;
      display: flex;
      gap: 0.375rem;
    }
    .dot {
      align-self: flex-start;
      border: 2px solid #ffffff;
      border-radius: 50%;
      /* The head's dot, as the track's head is drawn: a data colour, the taxon's. */
      box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.25);
      display: inline-block;
      flex: none;
      height: 0.75rem;
      margin-top: calc((1.5em - 1rem) / 2);
      width: 0.75rem;
    }
    .dot.unconfirmed {
      border-color: var(--taxon-color);
    }
    .dot:hover {
      /* The symbol's ring, darker: a data colour. */
      box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.55);
    }
    .title {
      flex-grow: 1;
    }
    .title > :not(b) {
      white-space: nowrap;
    }
    .count {
      color: var(--color-text-muted);
    }
    time {
      color: var(--color-text-muted);
      font-family: var(--font-mono);
      font-size: var(--fs-mono);
      white-space: nowrap;
    }
    ul.animals {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      list-style: none;
      margin: 0.375rem 0 0;
      padding: 0;
    }
    ul.animals li {
      background: var(--color-fill);
      border: 1px solid transparent;
      border-radius: 999px;
      line-height: 22px;
      padding: 0 8px;
      white-space: nowrap;
    }
    ul.animals li.possibly {
      background: transparent;
      border: 1px dashed var(--color-border-strong);
    }
    ul.animals a {
      color: inherit;
      text-decoration: none;
    }
    .support {
      color: var(--color-text-muted);
      font-size: var(--fs-caption);
      font-weight: 400;
      margin-left: 0.25rem;
    }
    p {
      margin: 0.5rem 0 0;
    }
    .movement {
      color: var(--color-text-secondary);
    }
    .latest .label {
      color: var(--color-text-muted);
    }
    /* The report's own text, rendered as its card renders it, on the same line as the label. */
    .latest .text, .latest .text > :first-child {
      display: inline;
    }
    .latest .text > * {
      margin: 0;
    }
    ul.photos {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      list-style: none;
      margin: 0.5rem 0 0;
      padding: 0;
    }
    ul.photos img {
      border-radius: 4px;
      display: block;
      height: 56px;
    }
    cite {
      color: var(--color-text-secondary);
      display: block;
      font-size: var(--fs-caption);
      font-style: normal;
      font-weight: 400;
      margin-top: 0.5rem;
    }
    button.toggle {
      background: none;
      border: 0;
      color: var(--color-primary);
      cursor: pointer;
      font-family: inherit;
      font-size: var(--fs-body2);
      margin: 0.25rem -0.5rem 0;
      min-height: 44px;
      padding: 0 0.5rem;
    }
    button.toggle:hover {
      color: var(--color-primary-hover);
    }
    button.toggle:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: -4px;
    }
    .reports {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 0.25rem;
    }
  `];

  /** The segment's reports, oldest first, as src/segments.ts joins them. */
  @property({attribute: false}) sightings: Occurrence[] = [];

  /** The sighting focused on the map, if any: one of these opens the card at it. */
  @property({attribute: false}) focusedId: string | null = null;

  @state() private open = false;
  @state() private catalogLoaded = catalogCodes() !== null;

  protected willUpdate(changed: PropertyValues<this>): void {
    if (!this.catalogLoaded)
      loadCatalogCodes().then(() => { this.catalogLoaded = true; }, () => { /* codes stay plain text */ });
    // A dot on the map that belongs to this segment opens it, so its own card can show.
    if ((changed.has('focusedId') || changed.has('sightings')) && this.focusedId
        && this.sightings.some(s => s.id === this.focusedId))
      this.open = true;
  }

  protected render() {
    const reports = this.sightings;
    const head = reports[reports.length - 1];
    if (!head) return nothing;
    const first = reports[0]!;
    const group = GROUPS[taxonGroup(head.taxon.scientific_name)];
    const unconfirmed = isUnconfirmed(head);
    const count = Math.max(0, ...reports.map(r => r.count ?? 0));
    const animals = pooledAnimals(reports.map(r => r.identifiers), catalogCodes() ?? new Map(),
      matrilineCodes() ?? new Map(), populationCodes() ?? new Map(), podCodes() ?? new Map());
    const latest = reports.findLast(r => r.body?.trim()) ?? null;
    const photos = reports.flatMap(r => (r.photos ?? []).map(photo => ({photo, sighting: r})));
    return html`
      <header>
        <a class="dot ${unconfirmed ? 'unconfirmed' : ''}" href="#" @click=${this.focusHead}
           aria-label="Focus this ${group.label.toLowerCase()} on the map" title="Focus on map"
           style="background-color: ${unconfirmed ? '#ffffff' : group.color}; --taxon-color: ${group.color}"></a>
        <span class="title"><b>${displayNameFor(head.taxon)}</b>${count ? html` <span class="count">×${count}</span>` : nothing}</span>
        <time>${clock(first)}–${clock(head)}</time>
      </header>
      ${animals.length ? html`<ul class="animals">${animals.map(({label, href, possibly, support}) => {
        const text = possibly ? `${label} (possibly)` : label;
        return html`<li class=${possibly ? 'possibly' : ''}>${href ? html`<a href=${href}>${text}</a>` : text}<span class="support"
          title=${`${support} of the ${reports.length} reports name ${label}`}>${support} of ${reports.length}</span></li>`;
      })}</ul>` : nothing}
      <p class="movement">${movementLine(segmentMovement(reports))}</p>
      ${latest ? html`<p class="latest"><span class="label">Latest, ${clock(latest)}:</span>
        <span class="text">${sightingText(latest.body, latest.provider_slug)}</span></p>` : nothing}
      ${photos.length ? html`<ul class="photos">${repeat(photos.slice(0, 4), ({photo}) => photo.src, ({photo, sighting}) => html`
        <li><a target="_blank" href=${sighting.url || photo.src}><img alt=${photo.attribution || 'photo of subject'} height="56" loading="lazy" src=${photo.thumb || photo.src}></a></li>`)}
        </ul>` : nothing}
      <cite>${sourcesLine(reports)}</cite>
      <button class="toggle" type="button" aria-expanded=${this.open ? 'true' : 'false'} @click=${this.toggle}>
        ${this.open ? 'Hide the reports' : `Show all ${reports.length} reports`}</button>
      ${this.open ? html`<div class="reports">${repeat([...reports].reverse(), r => r.id, r => {
        const focused = r.id === this.focusedId;
        return html`<obs-summary class=${classMap({focused})} id=${`summary-${r.id}`} ?focused=${focused} .sighting=${r}></obs-summary>`;
      })}</div>` : nothing}
    `;
  }

  private toggle = () => {
    this.open = !this.open;
  };

  private focusHead = (event: Event) => {
    event.preventDefault();
    const head = this.sightings[this.sightings.length - 1];
    this.dispatchEvent(new CustomEvent('focus-occurrence', {bubbles: true, composed: true, detail: head}));
  };
}

/** A report's time on the Pacific clock the day's list keeps, as a card shows it. */
function clock({observed_at}: Occurrence): string {
  return Temporal.Instant.from(observed_at).toZonedDateTimeISO('America/Los_Angeles').toPlainTime()
    .toString({smallestUnit: 'minute', roundingMode: 'halfCeil'});
}

const km = (n: number) => n < 10 ? `${n.toFixed(1)} km` : `${Math.round(n)} km`;

function duration(hours: number): string {
  const minutes = Math.round(hours * 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * "17 km along their path over 2 h 43 min, about 6 km/h, ending 3.5 km from the first
 * report; heading north at the last." The numbers only: what they say about behaviour
 * is salish-jdl2's.
 */
export function movementLine({pathKm, netKm, hours, lastDirection}: SegmentMovement): string {
  const speed = hours >= 0.25 ? `, about ${Math.round(pathKm / hours)} km/h` : '';
  const heading = lastDirection ? `; heading ${lastDirection} at the last` : '';
  return `${km(pathKm)} along their path over ${duration(hours)}${speed}, ending ${km(netKm)} from the first report${heading}.`;
}

/** "21 reports · via Orca Network ×19 · Orcasound · SalishSea.io", busiest channel first. */
export function sourcesLine(reports: readonly Occurrence[]): string {
  const channels = new Map<string, number>();
  for (const r of reports) {
    // Our own sightings are "SalishSea.io", as a card says of them, not "SalishSea.io Direct".
    const channel = r.provider_slug === 'direct' ? 'SalishSea.io' : r.collection || r.provider || 'another source';
    channels.set(channel, (channels.get(channel) ?? 0) + 1);
  }
  const via = [...channels].sort((a, b) => b[1] - a[1]).map(([c, n]) => n > 1 ? `${c} ×${n}` : c).join(' · ');
  return `${reports.length} reports · via ${via}`;
}

declare global {
  interface HTMLElementTagNameMap {
    'segment-summary': SegmentSummary;
  }
}
