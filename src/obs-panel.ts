import { css, html, LitElement } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from 'lit/directives/keyed.js';
import { Temporal } from "temporal-polyfill";
import './sighting-form.ts';
import './date-calendar.ts';
import { stepButtonStyles, stepIcon, type DateCalendar } from './date-calendar.ts';
import { cameraAddIcon, chevronLeftIcon, chevronRightIcon } from "./icons.ts";
import { consume } from "@lit/context";
import { userContext, type User } from "./identity.ts";
import { classMap } from "lit/directives/class-map.js";
import SightingForm, { newSighting, observationToFormData } from "./sighting-form.ts";
import { v7 } from "uuid";
import { type Occurrence } from "./types.ts";
import { DEFAULT_REGION_SLUG, EARLIEST_OBSERVATION_DATE, observationToday, REGIONS } from "./constants.ts";
import { createRef, ref } from "lit/directives/ref.js";

/** The date the calendar has selected, spelled out for the day-stepping row. */
const SELECTED_DATE_LABEL = {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'} as const;

// Regions live in constants.ts — they are the scope of the query now, not a
// list of places to look at, so the map and the occurrence fetch need them too.

@customElement('obs-panel')
export class ObsPanel extends LitElement {
  static styles = [stepButtonStyles, css`
    :host {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      font-family: Mukta,Helvetica,Arial,sans-serif;
      gap: 1rem;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      /* Reserve the scrollbar's width even when the day's list doesn't
         overflow, so stepping between full and empty days doesn't shift the
         header/calendar/region selector horizontally. */
      scrollbar-gutter: stable;
      scroll-behavior: smooth;
      touch-action: pan-y;
    }
    .full-bleed {
      align-self: stretch;
      margin-left: -0.5rem;
      margin-right: -0.5rem;
    }
    header {
      text-align: center;
    }
    h2 {
      font-size: 1.5rem;
      font-weight: 400;
      margin-bottom: 0;
      margin-top: 1rem;
    }
    /* Steps the day between the arrows, mirroring the calendar's month row
       above it. Subordinate to that heading — it restates the day the grid
       already rings, so it reads as a readout, not a second title. */
    .day-nav {
      align-items: center;
      display: flex;
      gap: 0.25rem;
      justify-content: center;
      margin: 0 auto;
      max-width: 21rem;
      padding-top: 0.25rem;
    }
    /* The readout doubles as the way to seek a distant date: the calendar pages
       a month at a time, and the corpus reaches back to 2012. Editing is behind
       a click so the resting state stays a readout, not a form control. */
    .day-nav .selected-date {
      background: none;
      border: 0;
      border-radius: 4px;
      color: #475569;
      cursor: pointer;
      flex-grow: 1;
      font-family: inherit;
      font-size: 0.8125rem;
      font-variant-numeric: tabular-nums;
      padding: 0.125rem 0.25rem;
      text-align: center;
      white-space: nowrap;
    }
    .day-nav .selected-date:hover {
      background: #f1f5f9;
      color: #1e293b;
    }
    .day-nav .selected-date:focus-visible {
      outline: 2px solid #1976d2;
      outline-offset: 1px;
    }
    /* Occupies the readout's slot so swapping between them doesn't shift the
       arrows either side. */
    .day-nav input[type=date] {
      background: white;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      box-sizing: border-box;
      color: #1e293b;
      flex-grow: 1;
      font-family: inherit;
      font-size: 0.8125rem;
      font-variant-numeric: tabular-nums;
      min-width: 0;
      padding: 0.0625rem 0.25rem;
      text-align: center;
    }
    .day-nav input[type=date]:focus-visible {
      border-color: #1976d2;
      outline: 2px solid #1976d2;
      outline-offset: 1px;
    }
    /* The destinations are laid out rather than hidden behind a select: there
       are only five, and seeing them is most of the value. */
    .go-to {
      align-items: baseline;
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
      justify-content: center;
      margin-top: 0.875rem;
    }
    #go-to-label {
      color: #64748b;
      font-size: 0.8125rem;
    }
    /* obs-summary's action buttons, rounded off — same tokens, bubble shape. */
    .bubble {
      background: white;
      border: 1px solid #cbd5e1;
      border-radius: 999px;
      color: #334155;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.8125rem;
      line-height: 1.4;
      padding: 0.1875rem 0.625rem;
      white-space: nowrap;
    }
    .bubble:hover:not(:disabled) {
      background: #f1f5f9;
      border-color: #94a3b8;
      color: #1e293b;
    }
    /* The selected region is the one piece of state in this row: it says what
       the map, the list and the calendar are all scoped to. Filled rather than
       merely outlined so it reads at a glance which one is active.

       These must come AFTER the hover rule. The hover selector has the same
       specificity as the selected-hover one — :not() contributes its argument's
       specificity — so on equal terms the later rule wins, and put first these
       would lose the fill exactly while the pointer is on them. */
    .bubble.selected {
      background: #0369a1;
      border-color: #0369a1;
      color: white;
      font-weight: 600;
    }
    .bubble.selected:hover:not(:disabled) {
      background: #075985;
      border-color: #075985;
      color: white;
    }
    .bubble:disabled {
      border-color: #e2e8f0;
      color: #cbd5e1;
      cursor: default;
    }
    .bubble:focus-visible {
      outline: 2px solid #1976d2;
      outline-offset: 1px;
    }
    button[name=show] {
      align-items: center;
      align-self: flex-start;
      cursor: pointer;
      display: inline-flex;
      gap: 0.5rem;
      vertical-align: middle;
      background: #1976d2;
      border: 1px solid #1976d2;
      border-radius: 4px;
      color: white;
      fill: white;
      font-size: 0.875rem;
      padding: 0.5rem 1rem;
    }
    button[name=show]:hover {
      background: #1565c0;
      border-color: #1565c0;
    }
    sighting-form {
      background-color: rgba(128, 128, 128, 0.1);
    }
    .contribute-pitch {
      background: rgba(25, 118, 210, 0.08);
      border-left: 3px solid #1976d2;
      border-radius: 4px;
      color: #1f2d3d;
      font-size: 0.9375rem;
      line-height: 1.45;
      margin: 0;
      padding: 0.625rem 0.75rem;
    }
    .contribute-pitch strong {
      font-weight: 600;
    }
    .contribute-pitch a {
      color: #1976d2;
      font-weight: 600;
      white-space: nowrap;
    }
    .hide {
      display: none;
    }
  `];

  @property({attribute: true, reflect: true, type: Boolean})
  public showForm: boolean = false

  @property({type: String, reflect: true})
  private date!: string;

  @property({type: String, reflect: true})
  public regionSlug: string = DEFAULT_REGION_SLUG;

  @consume({context: userContext, subscribe: true})
  @state()
  private user: User | undefined;

  @property({attribute: false})
  private sightingForForm = {...newSighting(), id: v7()};

  private formRef = createRef<SightingForm>();
  private calendarRef = createRef<DateCalendar>();
  private seekInputRef = createRef<HTMLInputElement>();

  /** Whether the date readout has been swapped for the seek input. */
  @state()
  private seekingDate = false;

  /**
   * Set when the seek editor is dismissed from the keyboard — by Escape, or by
   * committing a typed date. Removing the input drops focus to the body, which
   * strands a keyboard user; blur is excluded because they moved focus on purpose.
   */
  #returnFocusToReadout = false;

  @property({attribute: false})
  lastOwnOccurrence: Occurrence | null = null

  protected render() {
    const {id, ...sighting} = this.sightingForForm;
    // The same bounds the calendar disables its cells against, so the steppers
    // and the grid agree on where the navigable range ends.
    const selected = Temporal.PlainDate.from(this.date);
    const atToday = Temporal.PlainDate.compare(selected, observationToday()) >= 0;
    const atEarliest = Temporal.PlainDate.compare(selected, EARLIEST_OBSERVATION_DATE) <= 0;
    return html`
      <header>
        <h2>Marine Mammal Observations</h2>
        <date-calendar ${ref(this.calendarRef)} date=${this.date} regionSlug=${this.regionSlug}></date-calendar>
        <div class="day-nav">
          <button class="step" @click=${this.onGotoYesterday} type="button" name="yesterday" ?disabled=${atEarliest} aria-label="Previous day">${stepIcon(chevronLeftIcon)}</button>
          ${this.seekingDate ? html`
            <input
              ${ref(this.seekInputRef)}
              type="date"
              .value=${this.date}
              min=${EARLIEST_OBSERVATION_DATE.toString()}
              max=${observationToday().toString()}
              aria-label="Jump to a date"
              @change=${this.onSeekDate}
              @keydown=${this.onSeekKeydown}
              @blur=${this.stopSeekingDate}
            >
          ` : html`
            <button
              class="selected-date"
              type="button"
              title="Jump to a date"
              @click=${this.startSeekingDate}
            >${Temporal.PlainDate.from(this.date).toLocaleString(undefined, SELECTED_DATE_LABEL)}</button>
          `}
          <button class="step" @click=${this.onGotoTomorrow} type="button" name="tomorrow" ?disabled=${atToday} aria-label="Next day">${stepIcon(chevronRightIcon)}</button>
        </div>
        <div class="go-to" role="group" aria-labelledby="go-to-label">
          <span id="go-to-label">Showing:</span>
          ${REGIONS.map(({slug, label}) => html`
            <button
              class=${classMap({bubble: true, selected: slug === this.regionSlug})}
              type="button"
              aria-pressed=${slug === this.regionSlug ? 'true' : 'false'}
              @click=${() => this.selectRegion(slug)}
            >${label}</button>
          `)}
          <button
            class="bubble"
            type="button"
            ?disabled=${!this.lastOwnOccurrence}
            @click=${this.goToLastOwnOccurrence}
          >My last observation</button>
        </div>
      </header>
      ${keyed(id, html`
        <sighting-form
          ${ref(this.formRef)}
          class=${classMap({"full-bleed": true, hide: !this.showForm})}
          @cancel-edit=${this.onCancelEdit}
          @sighting-saved=${this.onSightingSaved}
          .initialValues=${sighting}
          sightingId=${id}
          date=${this.date}
        ></sighting-form>
      `)}
      ${!this.user && !this.showForm ? html`
        <p class="contribute-pitch">
          The public is our <strong>best source of data on how whales use these waters</strong> — add what you see.
          <a href="/about.html">Learn more.</a>
        </p>
      ` : ''}
      <button class=${classMap({hide: this.showForm})} @click=${this.doShowForm} type="button" name="show">
        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px">${cameraAddIcon}</svg>
        <span>Add a Sighting</span>
      </button>
      <slot></slot>
    `;
  }

  async editObservation(observation: Occurrence) {
    await this.doShowForm();
    // Prefer PST8PDT for consistency with sighting-form validation
    this.sightingForForm = observationToFormData(observation);
    this.formRef.value!.scrollIntoView();
  }

  private onCancelEdit() {
    this.showForm = false;
    this.sightingForForm = {...newSighting(), id: v7()};
  }

  private onSightingSaved() {
    this.showForm = false;
    this.sightingForForm = {...newSighting(), id: v7()};
    // The new sighting belongs to some day's volume; drop the cached counts so
    // its circle grows straight away.
    this.calendarRef.value?.refresh();
  }

  // Both steppers guard as well as disable. The upper bound moves while the page
  // is open (a tab left running past local midnight), and a guard here is the
  // only thing standing between a stray step and a date the calendar won't
  // render — it disables every cell outside the range, so the selection lands
  // somewhere the grid can't show and the occurrences query returns nothing for.
  private onGotoYesterday() {
    const date = Temporal.PlainDate.from(this.date).subtract({days: 1});
    if (Temporal.PlainDate.compare(date, EARLIEST_OBSERVATION_DATE) < 0)
      return;
    this.dispatchEvent(new CustomEvent('date-selected', {bubbles: true, composed: true, detail: date.toString()}));
  }

  private onGotoTomorrow() {
    const date = Temporal.PlainDate.from(this.date).add({days: 1});
    if (Temporal.PlainDate.compare(date, observationToday()) > 0)
      return;
    this.dispatchEvent(new CustomEvent('date-selected', {bubbles: true, composed: true, detail: date.toString()}));
  }

  private startSeekingDate() {
    this.seekingDate = true;
    // Focus once the input exists, so typing can start straight away. The native
    // picker is left to its own indicator rather than opened from here: it would
    // cover our calendar with a second one, and typing a distant date is the
    // affordance a month-at-a-time grid is missing.
    this.updateComplete.then(() => this.seekInputRef.value?.focus());
  }

  private stopSeekingDate() {
    this.seekingDate = false;
  }

  private onSeekDate(e: Event) {
    const {value} = e.target as HTMLInputElement;
    this.seekingDate = false;
    this.#returnFocusToReadout = true;
    // `min`/`max` only style an out-of-range value, they don't stop one being
    // entered — and a cleared or half-typed field fires change on some browsers.
    // Same bounds the steppers and the grid enforce, so none of them can disagree.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
      return;
    const date = Temporal.PlainDate.from(value);
    if (Temporal.PlainDate.compare(date, EARLIEST_OBSERVATION_DATE) < 0
      || Temporal.PlainDate.compare(date, observationToday()) > 0)
      return;
    this.dispatchEvent(new CustomEvent('date-selected', {bubbles: true, composed: true, detail: value}));
  }

  private onSeekKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      // Don't let it bubble to anything that treats Escape as a broader dismiss.
      e.stopPropagation();
      this.#returnFocusToReadout = true;
      this.stopSeekingDate();
    }
  }

  protected updated(): void {
    // The readout only exists once the input has been rendered away, so this
    // has to wait for the update rather than run in the handler.
    if (this.#returnFocusToReadout && !this.seekingDate) {
      this.#returnFocusToReadout = false;
      this.renderRoot.querySelector<HTMLButtonElement>('.selected-date')?.focus();
    }
  }

  /**
   * Selecting a region changes what the map, this list and the calendar are
   * scoped to — it is not just a camera move. salish-sea.ts owns that state and
   * also does the zoom, so the slug is all that travels.
   */
  private selectRegion(slug: string) {
    this.dispatchEvent(new CustomEvent('region-selected', {bubbles: true, composed: true, detail: slug}));
  }

  private goToLastOwnOccurrence() {
    if (!this.lastOwnOccurrence)
      return;
    this.dispatchEvent(new CustomEvent('focus-occurrence', {bubbles: true, composed: true, detail: this.lastOwnOccurrence}));
  }

  private async doShowForm() {
    if (!this.user) {
      this.dispatchEvent(new Event('log-in', {bubbles: true, composed: true}));
      return;
    }

    this.showForm = true;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "obs-panel": ObsPanel;
  }
}
