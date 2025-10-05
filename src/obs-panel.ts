import { css, html, LitElement} from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { live } from 'lit/directives/live.js';
import { keyed } from 'lit/directives/keyed.js';
import { Temporal } from "temporal-polyfill";
import './sighting-form.ts';
import { consume } from "@lit/context";
import { userContext, type User } from "./identity.ts";
import { classMap } from "lit/directives/class-map.js";
import SightingForm, { newSighting } from "./sighting-form.ts";
import { v7 } from "uuid";
import type { Occurrence } from "./supabase.ts";
import '@awesome.me/webawesome/dist/components/button/button.js';

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
    wa-button {
      align-self: flex-start;
      display: inline-flex;
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
  private user: User | undefined;

  @property({attribute: false})
  private sightingForForm = {...newSighting(), id: v7()};

  @query('sighting-form', false)
  sightingForm!: SightingForm

  protected render() {
    const {id, ...sighting} = this.sightingForForm;
    return html`
      <header>
        <h2>Marine Mammal Observations</h2>
        <form>
          <input @click=${this.onGotoYesterday} type="button" name="yesterday" value="◀">
          <input @click=${this.onGotoTomorrow}  type="button" name="tomorrow" value="▶" ?disabled=${this.date === today}>
          <input @change=${this.onDateChange} max=${today} min="2000-01-01" type="date" .value=${live(this.date)}>
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
      <wa-button class=${classMap({hide: this.showForm})} @click=${this.doShowForm} variant="brand" name="show">
        <wa-icon slot="start" name="camera"></wa-icon>
        Add a sighting
      </wa-button>
      <slot></slot>
    `;
  }

  async editSighting({body, count, direction, location: {lat, lon}, taxon: {scientific_name}, observed_at}: Occurrence) {
    await this.doShowForm();
    // Prefer PST8PDT for consistency with sighting-form validation
    const zdt = Temporal.Instant.from(observed_at);
    const observed_time = zdt.toZonedDateTimeISO('PST8PDT').toPlainTime().toString({ smallestUnit: 'second' });
    this.sightingForForm = {
      ...newSighting(),
      body: body || '',
      count: count ?? NaN,
      observed_time,
      subject_location: `${lat.toFixed(4)}, ${lon.toFixed(4)}`,
      taxon: scientific_name,
      travel_direction: direction ?? '',
      id: v7()
    };
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

  private async doShowForm() {
    if (!this.user) {
      this.dispatchEvent(new Event('log-in', {bubbles: true, composed: true}));
      return;
    }
    if (!this.user)
      throw new Error("Login succeeded but token was not available");

    this.showForm = true;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "obs-panel": ObsPanel;
  }
}
