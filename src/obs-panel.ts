import { css, html, LitElement, type PropertyValues} from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { live } from 'lit/directives/live.js';
import { keyed } from 'lit/directives/keyed.js';
import { Temporal } from "temporal-polyfill";
import './sighting-form.ts';
import { cameraAddIcon } from "./icons.ts";
import { consume } from "@lit/context";
import { userContext, type User } from "./identity.ts";
import { classMap } from "lit/directives/class-map.js";
import SightingForm, { newSighting, observationToFormData } from "./sighting-form.ts";
import { v7 } from "uuid";
import { supabase, type Occurrence } from "./supabase.ts";
import { salishSRKWExtent, srkwExtent } from "./constants.ts";
import { when } from "lit/directives/when.js";

const today = Temporal.Now.plainDateISO().toString();

@customElement('obs-panel')
export class ObsPanel extends LitElement {
  static styles = css`
    :host {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      font-family: Mukta,Helvetica,Arial,sans-serif;
      gap: 1rem;
      overflow: clip scroll;
      scroll-behavior: smooth;
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
    input[type=date] {
      -webkit-min-logical-width: 5rem;
    }
    button {
      align-items: center;
      align-self: flex-start;
      cursor: pointer;
      display: inline-flex;
      gap: 0.5rem;
      vertical-align: middle;
    }
    button[name=show] {
      background-color: rgb(27, 43, 123);
      border: none;
      border-radius: 4px;
      color: white;
      fill: white;
      font-weight: 500;
      padding: 1rem;
      text-transform: uppercase;
    }
    sighting-form {
      background-color: rgba(128, 128, 128, 0.1);
    }
    .hide {
      display: none;
    }
  `;

  @property({attribute: true, reflect: true, type: Boolean})
  public showForm: boolean = false

  @property({type: String, reflect: true})
  private date!: string;

  @consume({context: userContext, subscribe: true})
  @state()
  private user: User | undefined;

  @property({attribute: false})
  private sightingForForm = {...newSighting(), id: v7()};

  @query('sighting-form', false)
  sightingForm!: SightingForm

  @state()
  private lastOwnOccurrence: Occurrence | null = null

  protected render() {
    const {id, ...sighting} = this.sightingForForm;
    return html`
      <header>
        <h2>Marine Mammal Observations</h2>
        <form>
          <input @click=${this.onGotoYesterday} type="button" name="yesterday" value="◀">
          <input @click=${this.onGotoTomorrow}  type="button" name="tomorrow" value="▶" ?disabled=${this.date === today}>
          <input @change=${this.onDateChange} max=${today} min="2000-01-01" type="date" .value=${live(this.date)}>
          <select @change=${this.onGoTo} name="go-to">
            <option value='' selected disabled>Go to…</option>
            <option value=${salishSRKWExtent.join(',')}>Salish Sea</option>
            <option value=${srkwExtent.join(',')}>SRKW Range</option>
            <option value="my-last-occurrence" ?disabled=${!this.lastOwnOccurrence}>My last observation</option>
          </select>
        </form>
      </header>
      ${keyed(id, html`
        <sighting-form
          class=${classMap({"full-bleed": true, hide: !this.showForm})}
          @cancel-edit=${this.onCancelEdit}
          @sighting-saved=${this.onSightingSaved}
          .initialValues=${sighting}
          sightingId=${id}
          date=${this.date}
        ></sighting-form>
      `)}
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
    this.sightingForm.scrollIntoView();
  }

  private onCancelEdit() {
    this.showForm = false;
    this.sightingForForm = {...newSighting(), id: v7()};
  }

  private onSightingSaved() {
    this.showForm = false;
    this.sightingForForm = {...newSighting(), id: v7()};
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

  private onDateChange(e: Event) {
    const date = (e.target as HTMLInputElement).value;
    if (date && date.match(/^20\d\d-\d\d-\d\d$/)) {
      const dateSelected = new CustomEvent('date-selected', {bubbles: true, composed: true, detail: date})
      this.dispatchEvent(dateSelected);
    }
  }

  private async onGoTo(e: InputEvent) {
    e.preventDefault();
    const input = e.target as HTMLInputElement;
    if (input.value === 'my-last-occurrence') {
      const occurrence = this.lastOwnOccurrence!;
      this.dispatchEvent(new CustomEvent('focus-occurrence', {bubbles: true, composed: true, detail: occurrence}))
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
    if (!this.user)
      throw new Error("Login succeeded but token was not available");

    this.showForm = true;
  }

  protected updated(changedProperties: PropertyValues) {
    if (changedProperties.has('user'))
      this.fetchLastOccurrence();
  }

  async fetchLastOccurrence() {
    const {data: occurrence} = await supabase
      .from('occurrences')
      .select('*')
      .order('observed_at', {ascending: false})
      .limit(1)
      .maybeSingle();
    this.lastOwnOccurrence = occurrence as Occurrence | null;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "obs-panel": ObsPanel;
  }
}
