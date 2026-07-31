import { css, html, LitElement, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import { Temporal } from "temporal-polyfill";
import { supabase } from "./supabase.ts";
import { chevronLeftIcon, chevronRightIcon } from "./icons.ts";
import { monthGrid, volumeScale, WEEKDAY_INITIALS } from "./calendar.ts";
import { DEFAULT_REGION_SLUG, EARLIEST_OBSERVATION_DATE, observationToday, regionBySlug } from "./constants.ts";

const MONTH_LABEL = {month: 'long', year: 'numeric'} as const;
const DAY_LABEL = {weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'} as const;

/**
 * Diameter of a full-volume circle, as a percentage of the day cell. Held short
 * of the cell so even the busiest days keep a gap between neighbours — in peak
 * season most days sit near the top of the domain, and without that gap a summer
 * month reads as one solid mass rather than as a row of days.
 */
const FULL_VOLUME_DIAMETER = 72;

type Counts = Map<string, number>;

/** Wraps a step arrow's path in the icon set's shared viewBox. */
export const stepIcon = (path: unknown) =>
  html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true">${path}</svg>`;

/**
 * The date picker's arrow buttons — month steppers here, day steppers in
 * obs-panel. Lit styles are scoped per component, so the rule lives here as a
 * CSSResult both put in their `static styles` (the profile-shared convention).
 *
 * Quiet chrome rather than a form control: the arrows sit inside the picker and
 * step the label between them, so boxing them like the "Go to…" select would
 * overstate them and give the picker three competing button treatments.
 */
export const stepButtonStyles = css`
  .step {
    align-items: center;
    background: none;
    border: 0;
    border-radius: 4px;
    color: #64748b;
    cursor: pointer;
    display: flex;
    flex: 0 0 auto;
    height: 1.75rem;
    justify-content: center;
    padding: 0;
    width: 1.75rem;
  }
  .step svg {
    display: block;
    fill: currentColor;
    height: 1.25rem;
    width: 1.25rem;
  }
  .step:hover:not(:disabled) {
    background: #f1f5f9;
    color: #1e293b;
  }
  .step:disabled {
    color: #cbd5e1;
    cursor: default;
  }
  .step:focus-visible {
    outline: 2px solid #1976d2;
    outline-offset: 1px;
  }
`;

/**
 * A month calendar for picking the observation date, where each day carries a
 * circle sized by that day's sighting volume — so the shape of the season is
 * visible while choosing, and quiet days are obvious before they're clicked.
 *
 * Emits `date-selected` (bubbling, composed) with an ISO date string, the same
 * event the day-stepping buttons and the sighting form use.
 */
@customElement('date-calendar')
export class DateCalendar extends LitElement {
  static styles = [stepButtonStyles, css`
    :host {
      display: block;
      /* Restated rather than inherited: this is the panel's face, and a shadow
         root that silently changed font with its host would be a trap. */
      font-family: Mukta, Helvetica, Arial, sans-serif;
      user-select: none;
    }

    /* ---- month heading -------------------------------------------------- */

    /* Same 21rem measure and gap as the grid and the day-stepping row below it,
       so all three arrows sit on the same two vertical lines. */
    .month-nav {
      align-items: center;
      display: flex;
      gap: 0.25rem;
      justify-content: center;
      margin: 0 auto;
      max-width: 21rem;
    }
    h3 {
      color: #1e293b;
      flex-grow: 1;
      font-size: 0.9375rem;
      font-weight: 600;
      margin: 0;
      text-align: center;
    }

    /* ---- grid ----------------------------------------------------------- */

    /* Column headers, cell type and the blue volume ramp are the profile pages'
       presence table (profile-shared.ts) restated for a day grid — the site
       already has one way of showing activity over time. */
    .weekdays,
    .grid {
      display: grid;
      font-variant-numeric: tabular-nums;
      grid-template-columns: repeat(7, 1fr);
      margin: 0 auto;
      max-width: 21rem;
      width: 100%;
    }
    .weekdays {
      color: #94a3b8;
      font-size: 0.75rem;
      font-weight: 500;
      padding: 0.25rem 0 0.125rem;
      text-align: center;
    }

    .day {
      align-items: center;
      aspect-ratio: 1;
      background: none;
      border: 0;
      border-radius: 50%;
      color: #1e3a5f;
      cursor: pointer;
      display: flex;
      font-family: inherit;
      font-size: 0.8125rem;
      justify-content: center;
      padding: 0;
      position: relative;
      width: 100%;
    }

    /* The encoding: one hue, constant opacity, size alone carrying volume. */
    .volume {
      aspect-ratio: 1;
      background: #1976d2;
      border-radius: 50%;
      left: 50%;
      opacity: 0.32;
      position: absolute;
      top: 50%;
      translate: -50% -50%;
    }

    .numeral {
      position: relative; /* above the circle */
    }

    /* Days spilling in from the neighbouring months: present and clickable, but
       clearly not part of this month. */
    .outside {
      color: #94a3b8;
    }
    .outside .volume {
      opacity: 0.16;
    }
    .day:disabled {
      color: #cbd5e1;
      cursor: default;
    }

    /* ---- states --------------------------------------------------------- */

    .day:hover:not(:disabled) {
      box-shadow: inset 0 0 0 1px #cbd5e1;
    }
    .today .numeral {
      font-weight: 600;
    }
    .selected {
      box-shadow: inset 0 0 0 2px #1976d2;
      color: #1565c0;
    }
    .selected .numeral {
      font-weight: 600;
    }
    .day:hover.selected {
      box-shadow: inset 0 0 0 2px #1565c0;
    }
    .day:focus-visible {
      outline: 2px solid #1976d2;
      outline-offset: 1px;
    }
  `];

  /** The selected date, ISO `YYYY-MM-DD`. */
  @property({type: String})
  date!: string;

  /**
   * The active region. Day counts are scoped to it, so that a day's circle
   * counts exactly the sightings the map will draw when you click it.
   */
  @property({type: String})
  regionSlug: string = DEFAULT_REGION_SLUG;

  /** The month on screen. Follows `date` unless the user has paged away from it. */
  @state()
  private month: Temporal.PlainYearMonth = observationToday().toPlainYearMonth();

  /** Day (`YYYY-MM-DD`) → sighting count, for every month fetched so far. */
  @state()
  private counts: Counts = new Map();

  /** Months already requested, so paging back and forth doesn't refetch. */
  #fetched = new Set<string>();

  /**
   * Bumped by {@link refresh}. A request that was in flight when the counts were
   * invalidated carries the old generation and is dropped on arrival — without
   * this it would resolve after the refetch it raced and write its stale counts
   * back over the fresh ones.
   */
  #generation = 0;

  /** Day an arrow key moved to, awaiting focus once it has been rendered. */
  #pendingFocus: string | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    if (this.date)
      this.month = Temporal.PlainDate.from(this.date).toPlainYearMonth();
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    // Follow the selection when it lands outside the month on screen — a day
    // step across a boundary, or a jump to an occurrence from another season.
    if (changed.has('date') && this.date) {
      const selectedMonth = Temporal.PlainDate.from(this.date).toPlainYearMonth();
      if (!selectedMonth.equals(this.month))
        this.month = selectedMonth;
    }
  }

  protected updated(): void {
    this.fetchCounts(this.month);
    // An arrow key sends the new date up to the app and waits for it to come
    // back down; only once it has is the cell to focus the one under the
    // cursor. Focusing any earlier lands on a node the next render relabels.
    if (this.#pendingFocus && this.#pendingFocus === this.date) {
      const cell = this.renderRoot.querySelector<HTMLButtonElement>(`[data-date="${this.#pendingFocus}"]`);
      this.#pendingFocus = null;
      cell?.focus();
    }
  }

  /** Drop cached counts and refetch, e.g. after the user saves a sighting. */
  refresh(): void {
    this.#generation++;
    this.#fetched.clear();
    this.counts = new Map();
    this.fetchCounts(this.month);
  }

  protected render() {
    // Read once per render, not once per module load, so a tab open across
    // local midnight starts offering the new day.
    const today = observationToday();
    const selected = this.date ? Temporal.PlainDate.from(this.date) : null;
    const days = monthGrid(this.month);
    const firstOfMonth = this.month.toPlainDate({day: 1});
    const prevDisabled = Temporal.PlainYearMonth.compare(this.month, EARLIEST_OBSERVATION_DATE.toPlainYearMonth()) <= 0;
    const nextDisabled = Temporal.PlainYearMonth.compare(this.month, today.toPlainYearMonth()) >= 0;
    // Roving tabindex: one tab stop for the whole grid, on the selected day. If
    // the user has paged away from it, the 1st of the month takes the stop —
    // otherwise no cell would be tabbable and the grid would be unreachable.
    const tabbable = selected && days.some(d => d.equals(selected)) ? selected : firstOfMonth;

    return html`
      <div class="month-nav">
        <button class="step" @click=${() => this.pageMonth(-1)} ?disabled=${prevDisabled} type="button" aria-label="Previous month">${stepIcon(chevronLeftIcon)}</button>
        <h3 aria-live="polite">${firstOfMonth.toLocaleString(undefined, MONTH_LABEL)}</h3>
        <button class="step" @click=${() => this.pageMonth(1)} ?disabled=${nextDisabled} type="button" aria-label="Next month">${stepIcon(chevronRightIcon)}</button>
      </div>
      <div class="weekdays" aria-hidden="true">
        ${WEEKDAY_INITIALS.map(d => html`<span>${d}</span>`)}
      </div>
      <div class="grid" role="group" aria-label="Observation date" @keydown=${this.onKeydown}>
        ${days.map(day => this.renderDay(day, selected, tabbable, today))}
      </div>
    `;
  }

  private renderDay(
    day: Temporal.PlainDate,
    selected: Temporal.PlainDate | null,
    tabbable: Temporal.PlainDate,
    today: Temporal.PlainDate,
  ) {
    const iso = day.toString();
    const count = this.counts.get(iso) ?? 0;
    const disabled = Temporal.PlainDate.compare(day, today) > 0
      || Temporal.PlainDate.compare(day, EARLIEST_OBSERVATION_DATE) < 0;

    const written = day.toLocaleString(undefined, DAY_LABEL);
    const label = disabled
      ? written
      : `${written}, ${count === 1 ? '1 sighting' : `${count} sightings`}`;

    const scale = volumeScale(count);

    return html`
      <button
        class=${classMap({
          day: true,
          outside: day.month !== this.month.month,
          selected: !!selected && day.equals(selected),
          today: day.equals(today),
        })}
        type="button"
        data-date=${iso}
        ?disabled=${disabled}
        tabindex=${day.equals(tabbable) ? 0 : -1}
        aria-label=${label}
        title=${label}
        aria-current=${!!selected && day.equals(selected) ? 'date' : 'false'}
        @click=${() => this.selectDate(iso)}
      >
        ${scale > 0 ? html`<span class="volume" style=${styleMap({width: `${scale * FULL_VOLUME_DIAMETER}%`})}></span>` : ''}
        <span class="numeral">${day.day}</span>
      </button>
    `;
  }

  private selectDate(iso: string) {
    this.dispatchEvent(new CustomEvent('date-selected', {bubbles: true, composed: true, detail: iso}));
  }

  private pageMonth(delta: number) {
    this.month = delta < 0 ? this.month.subtract({months: 1}) : this.month.add({months: 1});
  }

  /**
   * Arrow-key movement across the grid. Only one day is tabbable (roving
   * tabindex), so the calendar costs one tab stop rather than 42.
   */
  private onKeydown(e: KeyboardEvent) {
    const steps: Record<string, number> = {
      ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
    };
    const step = steps[e.key];
    if (step === undefined)
      return;
    // Move from the cell under the cursor, which after paging months is not
    // necessarily the selected day.
    const from = (e.target as HTMLElement | null)?.getAttribute?.('data-date') ?? this.date;
    if (!from)
      return;
    const target = Temporal.PlainDate.from(from).add({days: step});
    if (Temporal.PlainDate.compare(target, observationToday()) > 0
      || Temporal.PlainDate.compare(target, EARLIEST_OBSERVATION_DATE) < 0)
      return;
    e.preventDefault();
    this.#pendingFocus = target.toString();
    this.selectDate(target.toString());
  }

  private async fetchCounts(month: Temporal.PlainYearMonth) {
    const generation = this.#generation;
    const key = month.toString();
    if (this.#fetched.has(key))
      return;
    this.#fetched.add(key);

    // The grid shows the tail of the previous month and the head of the next,
    // so fetch what's drawn, not just the month proper.
    const days = monthGrid(month);
    const from = days[0]!.toString();
    const to = days[days.length - 1]!.toString();

    // An RPC rather than a filtered view: the bbox has to apply before the
    // GROUP BY, and the view exposed only `day` and `occurrence_count`, so
    // there was nothing for a client-side predicate to bite on.
    const extent = regionBySlug(this.regionSlug).extent;
    // Everywhere omits the bounds entirely; the function defaults them to NULL,
    // which COALESCEs to whole-world limits.
    const [minLon, minLat, maxLon, maxLat] = extent ?? [undefined, undefined, undefined, undefined];
    const {data, error} = await supabase()
      .rpc('occurrence_days', {
        from_day: from,
        to_day: to,
        min_lon: minLon,
        min_lat: minLat,
        max_lon: maxLon,
        max_lat: maxLat,
      });

    // Superseded by a refresh while in flight. Bail before the error branch too:
    // this request's key was cleared by refresh() and re-added by the request
    // that replaced it, so deleting it here would evict a live entry.
    if (generation !== this.#generation)
      return;

    if (error) {
      // A calendar without circles is still a usable date picker; leave it bare.
      this.#fetched.delete(key);
      console.error('Failed to load sighting volume', error);
      return;
    }

    const counts = new Map(this.counts);
    for (const row of data ?? []) {
      if (row.day)
        counts.set(row.day, row.occurrence_count ?? 0);
    }
    this.counts = counts;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "date-calendar": DateCalendar;
  }
}
