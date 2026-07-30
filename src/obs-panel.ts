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
import { pugetSoundExtent, salishSRKWExtent, sanJuansExtent, srkwExtent } from "./constants.ts";
import { createRef, ref } from "lit/directives/ref.js";

const today = Temporal.Now.plainDateISO().toString();

/** The date the calendar has selected, spelled out for the day-stepping row. */
const SELECTED_DATE_LABEL = {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'} as const;

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
    select {
      background: white;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      box-sizing: border-box;
      cursor: pointer;
      font-family: inherit;
      font-size: 0.8125rem;
      max-width: 100%;
      padding: 0.375rem 0.5rem;
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
    .day-nav .selected-date {
      color: #475569;
      flex-grow: 1;
      font-size: 0.8125rem;
      font-variant-numeric: tabular-nums;
      text-align: center;
      white-space: nowrap;
    }
    .go-to {
      margin-top: 0.75rem;
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

  @consume({context: userContext, subscribe: true})
  @state()
  private user: User | undefined;

  @property({attribute: false})
  private sightingForForm = {...newSighting(), id: v7()};

  private formRef = createRef<SightingForm>();
  private calendarRef = createRef<DateCalendar>();

  @property({attribute: false})
  lastOwnOccurrence: Occurrence | null = null

  protected render() {
    const {id, ...sighting} = this.sightingForForm;
    return html`
      <header>
        <h2>Marine Mammal Observations</h2>
        <date-calendar ${ref(this.calendarRef)} date=${this.date}></date-calendar>
        <div class="day-nav">
          <button class="step" @click=${this.onGotoYesterday} type="button" name="yesterday" aria-label="Previous day">${stepIcon(chevronLeftIcon)}</button>
          <span class="selected-date">${Temporal.PlainDate.from(this.date).toLocaleString(undefined, SELECTED_DATE_LABEL)}</span>
          <button class="step" @click=${this.onGotoTomorrow} type="button" name="tomorrow" ?disabled=${this.date === today} aria-label="Next day">${stepIcon(chevronRightIcon)}</button>
        </div>
        <form class="go-to">
          <select @change=${this.onGoTo} name="go-to" aria-label="Go to a place">
            <option value='' selected disabled>Go to…</option>
            <option value=${pugetSoundExtent.join(',')}>Puget Sound</option>
            <option value=${salishSRKWExtent.join(',')}>Salish Sea</option>
            <option value=${sanJuansExtent.join(',')}>San Juans</option>
            <option value=${srkwExtent.join(',')}>SRKW Range</option>
            <option value="my-last-occurrence" ?disabled=${!this.lastOwnOccurrence}>My last observation</option>
          </select>
        </form>
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

  private onGotoYesterday() {
    const date = Temporal.PlainDate.from(this.date).subtract({days: 1});
    const dateSelected = new CustomEvent('date-selected', {bubbles: true, composed: true, detail: date.toString()})
    this.dispatchEvent(dateSelected);
  }

  private onGotoTomorrow() {
    const date = Temporal.PlainDate.from(this.date).add({days: 1});
    const dateSelected = new CustomEvent('date-selected', {bubbles: true, composed: true, detail: date.toString()})
    this.dispatchEvent(dateSelected);
  }

  private async onGoTo(e: InputEvent) {
    e.preventDefault();
    const input = e.target as HTMLInputElement;
    if (input.value === 'my-last-occurrence') {
      if (!this.lastOwnOccurrence)
        throw new Error("No lastOwnOccurrence to focus")
      this.dispatchEvent(new CustomEvent('focus-occurrence', {bubbles: true, composed: true, detail: this.lastOwnOccurrence}))
    } else {
      const extent = input.value.split(',').map(parseFloat);
      this.dispatchEvent(new CustomEvent('go-to-extent', {bubbles: true, composed: true, detail: extent}));
    }
    setTimeout(() => {
      input.value = '';
    }, 0);
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
