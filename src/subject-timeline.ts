import { css, html, LitElement, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { distance } from '@turf/distance';
import { Temporal } from 'temporal-polyfill';
import { formatDate } from './date-format.ts';
import type { Encounter } from './encounter.ts';
import { linkStyles } from './icons.ts';
import { catalogCodes, loadCatalogCodes, matrilineCodes, podCodes, pooledAnimals, populationCodes } from './individual-links.ts';
import { PLACE_LISTS, readPlaces, type Place, type PlaceList } from './places.ts';
import { fetchDayOccurrences } from './read-path.ts';
import { SEGMENT_CARD_MIN } from './segment-summary.ts';
import { occurrences2segments } from './segments.ts';
import { openAnimalLinkInSidebar } from './subject.ts';
import type { Occurrence } from './types.ts';
import './obs-summary.ts';
import './segment-summary.ts';

/**
 * An animal's or matriline's timeline in the sidebar (decision 098): its latest encounter's
 * card, then a card per month, newest first, each saying where, who else, its photos and how
 * its reports name the subject, and opening to a line per encounter, which opens to the
 * encounter's own card. Under All time, a card per year before the past 12 months opens to
 * its months. An encounter is one of a day's travel segments holding a report of the
 * subject; the build writes them (scripts/read-path/encounters.ts).
 */
@customElement('subject-timeline')
export class SubjectTimeline extends LitElement {
  static styles = [linkStyles, css`
    :host {
      display: block;
      font-size: var(--fs-body2);
    }
    .label {
      color: var(--color-text-muted);
      font-size: var(--fs-caption);
      font-weight: 400;
      margin: 1rem 0 0.25rem;
    }
    .span {
      background-color: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      margin-bottom: 0.5rem;
      padding: 0.625rem 0.75rem;
    }
    .span header {
      align-items: baseline;
      display: flex;
      gap: 0.5rem;
      justify-content: space-between;
    }
    .span h3 {
      font-size: var(--fs-body2);
      font-weight: 700;
      margin: 0;
    }
    .tally {
      color: var(--color-text-muted);
    }
    .span p {
      margin: 0.5rem 0 0;
    }
    .notable {
      font-weight: 400;
    }
    .where {
      color: var(--color-text-secondary);
    }
    .where .days {
      color: var(--color-text-muted);
    }
    .span p.with {
      color: var(--color-text-muted);
      font-size: var(--fs-caption);
      font-weight: 400;
      margin-bottom: -0.25rem;
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
    /* "and 39 others": words after the chips, not one of them. */
    ul.animals li.more {
      background: transparent;
      margin-left: 0;
      padding: 0 4px;
    }
    .support, .more {
      color: var(--color-text-muted);
      font-size: var(--fs-caption);
      font-weight: 400;
      margin-left: 0.25rem;
    }
    ul.photos {
      align-items: center;
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
      /* Passed over, as a card's sources are: Light at 12px, in the darker grey (style guide, rule 5). */
      font-weight: 300;
      margin-top: 0.5rem;
    }
    details > summary {
      color: var(--color-primary);
      cursor: pointer;
      font-weight: 400;
      line-height: 44px;
    }
    details > summary:hover {
      color: var(--color-primary-hover);
    }
    details > summary:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: -2px;
    }
    details.encounter {
      border-top: 1px solid var(--color-border);
    }
    details.encounter > summary {
      color: inherit;
      display: block;
      line-height: 1.5;
      list-style: none;
      min-height: 44px;
      padding: 0.25rem 0;
    }
    details.encounter > summary::-webkit-details-marker {
      display: none;
    }
    details.encounter > summary:hover {
      background: var(--color-surface-subtle);
      color: inherit;
    }
    .when {
      display: flex;
      justify-content: space-between;
    }
    .when b {
      font-weight: 400;
    }
    details.encounter[open] .when b {
      color: var(--color-primary);
    }
    time {
      color: var(--color-text-muted);
      font-family: var(--font-mono);
      font-size: var(--fs-mono);
      white-space: nowrap;
    }
    .what {
      color: var(--color-text-secondary);
      display: block;
    }
    encounter-card {
      margin: 0.25rem 0 0.5rem;
    }
    .gap {
      align-items: center;
      color: var(--color-text-muted);
      display: flex;
      font-size: var(--fs-caption);
      font-weight: 400;
      gap: 0.5rem;
      margin: 0 0 0.5rem;
    }
    .gap::before, .gap::after {
      border-top: 1px dashed var(--color-border-strong);
      content: "";
      flex: 1;
    }
    .span .span {
      margin-top: 0.5rem;
    }
  `];

  /** The subject's encounters, newest first, as the build writes them. */
  @property({attribute: false}) encounters: Encounter[] = [];
  /** Which of them the list shows, as the switch says (decisions 096 and 098). */
  @property() scope: Scope = 'year';
  /** What the subject is called in a line about its reports: "T065A5". */
  @property() designation = '';
  /** The pages of the subject and the groups it is in, whose chips aren't "who else". */
  @property({attribute: false}) ownPaths: readonly string[] = [];
  /** The moment the past 12 months end at; now, but for a test. */
  @property({attribute: false}) now = Date.now();

  @state() private places: Place[] | null = null;
  @state() private catalogLoaded = catalogCodes() !== null;

  constructor() {
    super();
    // A chip opens its animal in the sidebar, as on a sighting's card.
    this.addEventListener('click', openAnimalLinkInSidebar);
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    if (!this.catalogLoaded)
      loadCatalogCodes().then(() => { this.catalogLoaded = true; }, () => { /* chips stay unlinked */ });
    if (changed.has('encounters') && this.encounters.length && !this.places)
      loadWaters().then(places => { this.places = places; }, () => { /* rows say no place */ });
  }

  protected render() {
    const encounters = this.encounters;
    const latest = encounters[0];
    if (!latest) return nothing;
    const start = scopeStart(this.now);
    const recent = encounters.filter(e => e.day >= start);
    const months = groupBy(recent, e => e.day.slice(0, 7));
    const older = this.scope === 'all' ? groupBy(encounters.filter(e => e.day < start), e => e.day.slice(0, 4)) : [];
    const context = this.context();
    return html`
      <encounter-card .encounter=${latest}></encounter-card>
      <p class="label">Past 12 months: ${plural(new Set(recent.map(e => e.day)).size, 'day')}, ${plural(recent.length, 'encounter')}</p>
      ${months.map(([month, list], i) => html`
        ${i ? gapLine(months[i - 1]![0], month) : nothing}
        ${this.renderSpan(monthName(month), list, context, {open: i === 0})}`)}
      ${older.length ? html`
        <p class="label">Before then</p>
        ${older.map(([year, list]) => {
          const inner = groupBy(list, e => e.day.slice(0, 7));
          return this.renderSpan(year, list, context, {months: inner});
        })}` : nothing}
    `;
  }

  private context(): SpanContext {
    const all = [...this.encounters].reverse();
    const firstOfYear = new Map<string, string>();
    for (const e of all) if (!firstOfYear.has(e.day.slice(0, 4))) firstOfYear.set(e.day.slice(0, 4), e.day);
    const days = [...new Set(all.map(e => e.day))];
    const previousDay = new Map(days.map((d, i) => [d, days[i - 1] ?? null]));
    return {firstOfYear, previousDay};
  }

  private renderSpan(title: string, list: Encounter[], context: SpanContext,
                     {open = false, months}: {open?: boolean, months?: [string, Encounter[]][]} = {}): TemplateResult {
    const s = summarizeSpan(list, {placeOf: this.placeOf, ownPaths: this.ownPaths, codes: this.codes()});
    const oldest = list[list.length - 1]!.day;
    const before = context.previousDay.get(oldest);
    const gap = before ? daysBetween(before, oldest) : null;
    // A year's card has its months' notes inside it.
    const notable = months ? null
      : context.firstOfYear.get(oldest.slice(0, 4)) === oldest
        ? `First report of ${oldest.slice(0, 4)}: ${shortDay(oldest)}${gap && gap > LONG_GAP ? `, after ${plural(gap, 'day')} without one` : ''}`
        : gap && gap > LONG_GAP ? `First report in ${plural(gap, 'day')}` : null;
    return html`
      <article class="span">
        <header><h3>${title}</h3><span class="tally">${plural(s.days, 'day')} · ${plural(list.length, 'encounter')}</span></header>
        ${notable ? html`<p class="notable">${notable}</p>` : nothing}
        ${s.waters.length ? html`<p class="where">${s.waters.slice(0, 3).map((w, i) => html`${i ? ', ' : ''}${w.name} <span class="days">${plural(w.days, 'day')}</span>`)}${
          s.waters.length > 3 ? `, and ${plural(s.waters.length - 3, 'other place')}` : ''}.${
          s.farthest && s.farthest.km > FAR_APART_KM ? ` From ${s.farthest.from} to ${s.farthest.to}, ${km(s.farthest.km)} apart.` : ''}</p>` : nothing}
        ${s.others.length ? html`
          <p class="with">With</p>
          <ul class="animals">${s.others.slice(0, MAX_CHIPS).map(a => html`<li class=${a.possibly ? 'possibly' : ''}><a href=${a.href}>${a.label}</a><span class="support"
            title=${`${a.encounters} of the ${list.length} encounters name ${a.label}`}>${a.encounters} of ${list.length}</span></li>`)}${
            s.others.length > MAX_CHIPS ? html`<li class="more">and ${plural(s.others.length - MAX_CHIPS, 'other')}</li>` : nothing}</ul>` : nothing}
        ${s.photos.length ? html`<ul class="photos">${s.photos.slice(0, MAX_PHOTOS).map(p => html`<li><a target="_blank" href=${p.href}><img
          alt=${p.attribution || 'photo of the encounter'} height="56" loading="lazy" src=${p.thumb || p.src}></a></li>`)}${
          s.photos.length > MAX_PHOTOS ? html`<li class="more">+${s.photos.length - MAX_PHOTOS}</li>` : nothing}</ul>` : nothing}
        <cite>${reportsLine(this.designation, s)} · via ${s.channels.map(([c, n]) => n > 1 ? `${c} ×${n}` : c).join(' · ')}</cite>
        <details ?open=${open}>
          <summary>${months ? `Show its ${plural(months.length, 'month')}` : `Show the ${plural(list.length, 'encounter')}`}</summary>
          ${months
            ? months.map(([month, inner], i) => html`${i ? gapLine(months[i - 1]![0], month) : nothing}${this.renderSpan(monthName(month), inner, context)}`)
            : list.map(e => this.renderRow(e))}
        </details>
      </article>
    `;
  }

  private renderRow(e: Encounter) {
    const naming = e.ids.length === e.reports ? '' : `, ${e.ids.length} naming ${this.designation}`;
    const others = encounterOthers(e, this.ownPaths, this.codes()).length;
    const where = this.placeOf(e);
    const parts = [
      where,
      `${plural(e.reports, 'report')}${naming}`,
      others ? `with ${plural(others, 'other')}` : null,
      e.photos.length ? plural(e.photos.length, 'photo') : null,
    ].filter(Boolean);
    return html`
      <details class="encounter" @toggle=${this.onToggle}>
        <summary>
          <span class="when"><b>${shortDay(e.day)}</b><time>${clock(e.start)}–${clock(e.end)}</time></span>
          <span class="what">${parts.join(' · ')}</span>
        </summary>
        <encounter-card .encounter=${e} lazy></encounter-card>
      </details>
    `;
  }

  /** Where an encounter was, once the places have loaded: worked out once each. */
  #placeNames = new WeakMap<Encounter, string | null>();
  private placeOf = (e: Encounter): string | null => {
    if (!this.places || !e.location) return null;
    let name = this.#placeNames.get(e);
    if (name === undefined) this.#placeNames.set(e, name = nearestName(this.places, e.location));
    return name;
  };

  private codes(): Codes {
    return [catalogCodes() ?? new Map(), matrilineCodes() ?? new Map(), populationCodes() ?? new Map(), podCodes() ?? new Map()];
  }

  // An encounter's card loads its day only once its line is opened.
  private onToggle = (event: Event) => {
    const details = event.currentTarget as HTMLDetailsElement;
    const card = details.querySelector('encounter-card');
    if (card && details.open) card.lazy = false;
  };
}

/**
 * One encounter's own card: its day's file, joined into segments as the map joins it, and
 * the segment that holds the encounter's reports shown as the day's list shows it, one card
 * for SEGMENT_CARD_MIN reports or more (decision 097), each report's card for fewer.
 */
@customElement('encounter-card')
export class EncounterCard extends LitElement {
  static styles = css`
    :host {
      display: block;
    }
    .reports {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .status {
      color: var(--color-text-muted);
      margin: 0;
    }
  `;

  @property({attribute: false}) encounter: Encounter | null = null;
  /** Set while its line is closed: nothing is fetched until it opens. */
  @property({type: Boolean}) lazy = false;

  @state() private reports: Occurrence[] | null | undefined = undefined;

  protected willUpdate(changed: PropertyValues<this>): void {
    if ((changed.has('encounter') || changed.has('lazy')) && this.encounter && !this.lazy && this.reports === undefined)
      void this.load(this.encounter);
  }

  private async load(encounter: Encounter): Promise<void> {
    this.reports = undefined;
    let reports: Occurrence[] | null = null;
    try {
      reports = segmentHolding(await dayRows(encounter.day), encounter.ids[0]!);
    } catch {
      // Without its day, the line above still says what the encounter was.
    }
    if (this.encounter === encounter) this.reports = reports;
  }

  protected render() {
    if (this.lazy || !this.encounter) return nothing;
    const reports = this.reports;
    if (reports === undefined) return html`<p class="status">Loading the encounter…</p>`;
    if (!reports) return html`<p class="status">Couldn't load this encounter's reports.</p>`;
    if (reports.length >= SEGMENT_CARD_MIN) return html`<segment-summary .sightings=${reports}></segment-summary>`;
    return html`<div class="reports">${[...reports].reverse().map(r => html`<obs-summary .sighting=${r}></obs-summary>`)}</div>`;
  }
}

// --- What a span's card says -----------------------------------------------------------

export type Scope = 'year' | 'all';

/** Spans shorter than this between reports aren't worth a note; longer ones are. */
const LONG_GAP = 21;
/** Encounters closer than this aren't a range worth naming. */
const FAR_APART_KM = 10;
const MAX_CHIPS = 6;
const MAX_PHOTOS = 4;
/**
 * Water bodies this large or larger name where an encounter was: the basemap labels them
 * by zoom 10. A stand-in for a better place name (salish-fwyt.2).
 */
const WATER_ZOOM = 10;

type Codes = Parameters<typeof pooledAnimals> extends [unknown, ...infer Rest] ? Rest : never;

interface SpanContext {
  firstOfYear: Map<string, string>;
  previousDay: Map<string, string | null>;
}

/**
 * The first Pacific day of the past 12 months: the first of the month eleven months
 * before this one, so a month is never split between the list's two parts, and the map
 * draws what the list lists (decision 098).
 */
export function scopeStart(now: number): string {
  const today = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO('America/Los_Angeles').toPlainDate();
  return today.toPlainYearMonth().subtract({months: 11}).toPlainDate({day: 1}).toString();
}

export interface SpanSummary {
  days: number;
  /** The water bodies its encounters were in, each with how many days, most days first. */
  waters: {name: string, days: number}[];
  /** Its two encounters farthest apart. */
  farthest: {from: string, to: string, km: number} | null;
  /** The other animals and groups its encounters name, each with how many encounters name it. */
  others: {label: string, href: string, possibly: boolean, encounters: number}[];
  photos: Encounter['photos'];
  /** How many reports name the subject, how many of those name it itself, and how many reports in all. */
  naming: number;
  asSelf: number;
  reports: number;
  channels: [string, number][];
}

export function summarizeSpan(list: readonly Encounter[], {placeOf, ownPaths, codes}:
    {placeOf: (e: Encounter) => string | null, ownPaths: readonly string[], codes: Codes}): SpanSummary {
  const waterDays = new Map<string, Set<string>>();
  const named: {name: string, at: {lon: number, lat: number}}[] = [];
  for (const e of list) {
    const name = placeOf(e);
    if (!name || !e.location) continue;
    (waterDays.get(name) ?? waterDays.set(name, new Set()).get(name)!).add(e.day);
    named.push({name, at: e.location});
  }
  let farthest: SpanSummary['farthest'] = null;
  // Between two places: "From Haro Strait to Haro Strait" says nothing.
  for (let i = 0; i < named.length; i++) for (let j = i + 1; j < named.length; j++) {
    if (named[i]!.name === named[j]!.name) continue;
    const d = distance([named[i]!.at.lon, named[i]!.at.lat], [named[j]!.at.lon, named[j]!.at.lat], {units: 'kilometers'});
    if (!farthest || d > farthest.km) farthest = {from: named[i]!.name, to: named[j]!.name, km: d};
  }
  const others = new Map<string, SpanSummary['others'][number]>();
  for (const e of list) for (const a of encounterOthers(e, ownPaths, codes)) {
    const seen = others.get(a.href);
    if (seen) { seen.encounters++; seen.possibly &&= a.possibly; }
    else others.set(a.href, {label: a.label, href: a.href, possibly: a.possibly, encounters: 1});
  }
  const channels = new Map<string, number>();
  for (const e of list) for (const [c, n] of e.channels) channels.set(c, (channels.get(c) ?? 0) + n);
  return {
    days: new Set(list.map(e => e.day)).size,
    waters: [...waterDays].map(([name, days]) => ({name, days: days.size})).sort((a, b) => b.days - a.days),
    farthest,
    others: [...others.values()].sort((a, b) => b.encounters - a.encounters),
    photos: list.flatMap(e => e.photos),
    naming: list.reduce((n, e) => n + e.ids.length, 0),
    asSelf: list.reduce((n, e) => n + e.as_self, 0),
    reports: list.reduce((n, e) => n + e.reports, 0),
    channels: [...channels].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}

/** The animals and groups an encounter names besides the subject and its groups: those with pages, not populations or pods. */
function encounterOthers(e: Encounter, ownPaths: readonly string[], codes: Codes) {
  return pooledAnimals(e.identifiers, ...codes).flatMap(a =>
    a.href && !ownPaths.includes(a.href) && !/^\/(populations|pods)\//.test(a.href) ? [{...a, href: a.href}] : []);
}

/** "86 of 140 reports name T065A5, 12 of them through a group it is in." */
export function reportsLine(designation: string, {naming, asSelf, reports}: Pick<SpanSummary, 'naming' | 'asSelf' | 'reports'>): string {
  const through = naming - asSelf;
  const which = naming === reports ? (reports === 1 ? 'The one report' : `All ${plural(reports, 'report')}`) : `${naming.toLocaleString('en-US')} of ${plural(reports, 'report')}`;
  return `${which} ${naming === 1 ? 'names' : 'name'} ${designation}${
    through ? `, ${through === naming ? (naming === 1 ? 'through' : 'all through') : `${through} of them through`} a group it is in` : ''}`;
}

/** The name of the larger water body nearest a point (WATER_ZOOM). */
export function nearestName(places: readonly Place[], {lon, lat}: {lon: number, lat: number}): string | null {
  let best: Place | null = null;
  let bestKm = Infinity;
  for (const p of places) {
    const d = distance([lon, lat], [p.lon, p.lat], {units: 'kilometers'});
    if (d < bestKm) { best = p; bestKm = d; }
  }
  return best?.name ?? null;
}

let waters: Promise<Place[]> | null = null;

/** The basemap's larger water bodies, fetched once: the lists the search field loads too. */
function loadWaters(): Promise<Place[]> {
  waters ??= Promise.all(PLACE_LISTS.map(async url => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    return readPlaces(await response.json() as PlaceList);
  })).then(lists => lists.flat().filter(p => p.kind === 'water' && p.zoom <= WATER_ZOOM));
  waters.catch(() => { waters = null; });
  return waters;
}

const days = new Map<string, Promise<Occurrence[]>>();

/** A day's reports from its file, kept for the page's life: two encounters on one day share it. */
function dayRows(day: string): Promise<Occurrence[]> {
  let rows = days.get(day);
  if (!rows) {
    rows = fetchDayOccurrences<Omit<Occurrence, 'observed_at_ms'>>(day, null)
      .then(list => list.map(r => ({...r, observed_at_ms: Date.parse(r.observed_at)}) as Occurrence));
    rows.catch(() => days.delete(day));
    days.set(day, rows);
  }
  return rows;
}

/** The reports of the day's segment that holds `id`, oldest first; null if none does. */
export function segmentHolding(rows: Occurrence[], id: string): Occurrence[] | null {
  return occurrences2segments(rows).find(s => s.occurrences.some(o => o.id === id))?.occurrences ?? null;
}

// --- Words ----------------------------------------------------------------------------

function groupBy<T>(list: readonly T[], key: (t: T) => string): [string, T[]][] {
  const out = new Map<string, T[]>();
  for (const t of list) (out.get(key(t)) ?? out.set(key(t), []).get(key(t))!).push(t);
  return [...out];
}

const plural = (n: number, one: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : `${one}s`}`;

const km = (n: number) => n < 10 ? `${n.toFixed(1)} km` : `${Math.round(n)} km`;

const monthName = (month: string) => formatDate(Temporal.PlainDate.from(`${month}-01`), {month: 'long', year: 'numeric'});

const shortDay = (day: string) => formatDate(Temporal.PlainDate.from(day), {weekday: 'short', month: 'short', day: 'numeric'});

const daysBetween = (from: string, to: string) => Temporal.PlainDate.from(from).until(to).days;

/** A report's time on the Pacific clock the day's list keeps. */
const clock = (at: string) => Temporal.Instant.from(at).toZonedDateTimeISO('America/Los_Angeles').toPlainTime()
  .toString({smallestUnit: 'minute', roundingMode: 'halfCeil'});

/** "No reports in July to August 2026", between a newer month and an older one with reports. */
export function gapLine(newer: string, older: string) {
  const missing: string[] = [];
  for (let m = Temporal.PlainYearMonth.from(newer).subtract({months: 1}); Temporal.PlainYearMonth.compare(m, Temporal.PlainYearMonth.from(older)) > 0; m = m.subtract({months: 1}))
    missing.push(m.toString());
  if (!missing.length) return nothing;
  const [last, first] = [monthName(missing[0]!), monthName(missing[missing.length - 1]!)];
  return html`<p class="gap">No reports in ${missing.length === 1 ? first : `${first} to ${last}`}</p>`;
}

declare global {
  interface HTMLElementTagNameMap {
    'subject-timeline': SubjectTimeline;
    'encounter-card': EncounterCard;
  }
}
