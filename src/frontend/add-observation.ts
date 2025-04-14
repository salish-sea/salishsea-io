import { css, html, LitElement, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {Task} from '@lit/task';
import { fromLonLat, toLonLat } from "ol/proj.js";
import { bearing as getBearing } from "@turf/bearing";
import { point as turfPoint } from "@turf/helpers";
import { distance as getDistance } from '@turf/distance';
import Point from "ol/geom/Point.js";
import { consume } from "@lit/context";
import Feature from "ol/Feature.js";
import drawingSourceContext from "./drawing-context.ts";
import type VectorSource from "ol/source/Vector.js";
import { createRef, ref } from "lit/directives/ref.js";
import { featureStyle, sighterStyle, type SightingStyleProperties } from "./style.ts";
import type { SightingForm } from "../types.ts";
import { Temporal } from "temporal-polyfill";

@customElement('add-observation')
export default class AddObservation extends LitElement {
  @property()
  id!: string

  @property()
  date!: string

  @consume({context: drawingSourceContext})
  drawingSource!: VectorSource<Feature<Point>>

  #observerPoint = new Point(fromLonLat([-122.507610, 47.865992]));
  #subjectPoint = new Point(fromLonLat([-122.415213, 47.897265]));

  @state()
  private bearing: number | null = null

  @state()
  private distance: number | null = null

  formRef = createRef<HTMLFormElement>();
  observerInputRef = createRef<HTMLInputElement>();
  subjectInputRef = createRef<HTMLInputElement>();

  private _saveTask = new Task(this, {
    autoRun: false,
    task: async ([request]: [Request]) => {
      const response = await fetch(request);
      const data = (await response.json()) as SightingForm;
      const event = new CustomEvent('observation-created', {bubbles: true, composed: true, detail: data});
      this.dispatchEvent(event);
      this.formRef.value!.reset();
      return data;
    },
  });

  static styles = css`
    .material-icons {
      font-family: 'Material Icons';
      font-weight: normal;
      font-style: normal;
      font-size: 1.5em;  /* Preferred icon size */
      display: inline-block;
      line-height: 1;
      text-transform: none;
      letter-spacing: normal;
      word-wrap: normal;
      white-space: nowrap;
      direction: ltr;

      /* Support for all WebKit browsers. */
      -webkit-font-smoothing: antialiased;
      /* Support for Safari and Chrome. */
      text-rendering: optimizeLegibility;

      /* Support for Firefox. */
      -moz-osx-font-smoothing: grayscale;

      /* Support for IE. */
      font-feature-settings: 'liga';
    }
    :host {
      display: block;
      font-family: Mukta,Helvetica,Arial,sans-serif;
    }
    form {
      background-color: rgba(128, 128, 128, 0.1);
      border: 1px solid gray;
      border-radius: 0.5rem;
      display: none;
      padding: 0.5rem;
    }
    :host(.show) form {
      display: block;
    }
    :host(.show) [name=show] {
      display: none;
    }
    button {
      align-items: center;
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
    label {
      display: block;
    }
    label span {
      display: inline-block;
      vertical-align: top;
      width: 10em;
    }
    label:has(input[required]) span::after {
      content: ' *';
    }
    input[readonly]::-webkit-outer-spin-button, input[readonly]::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
    input[type=number][readonly] {
      -moz-appearance: textfield;
    }
    .actions {
      text-align: right;
    }
    output {
      display: block;
    }
    output.error {
      color: red;
    }
    output.success {
      color: green;
    }
  `;

  protected render() {
    return html`
      <button @click=${this.show} type="button" name="show">
        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px"><path d="M440-440ZM120-120q-33 0-56.5-23.5T40-200v-480q0-33 23.5-56.5T120-760h126l74-80h240v80H355l-73 80H120v480h640v-360h80v360q0 33-23.5 56.5T760-120H120Zm640-560v-80h-80v-80h80v-80h80v80h80v80h-80v80h-80ZM440-260q75 0 127.5-52.5T620-440q0-75-52.5-127.5T440-620q-75 0-127.5 52.5T260-440q0 75 52.5 127.5T440-260Zm0-80q-42 0-71-29t-29-71q0-42 29-71t71-29q42 0 71 29t29 71q0 42-29 71t-71 29Z"/></svg>
        <span>Add a Sighting</span>
      </button>
      <form ${ref(this.formRef)} @submit=${this.onSubmit} action="/api/sightings/${this.id}">
        <label>
          <span>URL</span>
          <input type="url" name="url" />
        </label>
        <label>
          <span>Species</span>
          <select name="taxon">
            <option value="Orcinus orca" selected>Killer Whale (any type)</option>
            <option value="Orcinus orca ater">Resident Killer Whale</option>
            <option value="Orcinus orca rectipinnus">Bigg's Killer Whale</option>
          </select>
        </label>
        <label>
          <span>Count</span>
          <input type="number" name="count" value="" min="0" max="100">
        </label>
        <label>
          <span>Time</span>
          <input type="time" name="observed_time" required />
        </label>
        <label>
          <span>Observer location</span>
          <input @change=${this.onObserverInputChange} ${ref(this.observerInputRef)} type="text" name="observer_location" size="16" placeholder="lon, lat" required>
        </label>
        <label>
          <span>Subject location</span>
          <input @change=${this.onSubjectInputChange} ${ref(this.subjectInputRef)} type="text" name="subject_location" size="16" placeholder="lon, lat" required>
        </label>
        <label>
          <span>Bearing</span>
          <input type="number" name="bearing" value="${this.bearing === null ? '' : this.bearing.toFixed(3)}" readonly>°
        </label>
        <label>
          <span>Distance</span>
          <input type="number" name="distance" value="${this.distance === null ? '' : this.distance.toFixed(1)}" readonly min="0" max="10"> km
        </label>
        <label>
          <span>Notes</span>
          <textarea name="body" rows="3" cols="21"></textarea>
        </label>
        <div><em>* required field</em></div>
        <div class="actions">
          ${this._saveTask.render({
            initial: () => html`
              <output>&nbsp;</output>
              <button type="button" @click=${this.hide}>Cancel</button>
              <button type="submit">Create</button>
            `,
            pending: () => html`
              <output>&nbsp;</output>
              <button type="button" @click=${this.hide}>Cancel</button>
              <button type="submit" disabled>Create</button>
            `,
            complete: (value: SightingForm) => html`
              <output class="success">Sighting created.</output>
              <button type="button" @click=${this.hide}>Cancel</button>
              <button type="submit">Update</button>
            `,
            error: (error: unknown) => html`
              <output class="error">${error}</output>
              <button type="button" @click=${this.hide}>Cancel</button>
              <button type="submit">Create</button>
            `
          })}
        </div>
      </form>
    `;
  }

  onObserverInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const match = input.value.match(/^\s*(-[0-9]{3}.[0-9]+),\s*([0-9][0-9].[0-9]+)\s*$/);
    if (match) {
      const [, lon, lat] = match.map(v => parseFloat(v));
      this.#observerPoint.setCoordinates(fromLonLat([lon!, lat!]));
    }
  }

  onSubjectInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const match = input.value.match(/^\s*(-[0-9]{3}.[0-9]+),\s*([0-9][0-9].[0-9]+)\s*$/);
    if (match) {
      const [, lon, lat] = match.map(v => parseFloat(v));
      // This triggers onCoordinatesChanged
      this.#subjectPoint.setCoordinates(fromLonLat([lon!, lat!]));
    }
  }

  onCoordinatesChanged() {
    const observerCoordinates = toLonLat(this.#observerPoint.getCoordinates());
    const subjectCoordinates = toLonLat(this.#subjectPoint.getCoordinates());
    const observerInput = this.observerInputRef.value;
    const subjectInput = this.subjectInputRef.value;
    let observerCoordinateStr = observerCoordinates.map(v => v.toFixed(4)).join(', ');
    let subjectCoordinateStr = subjectCoordinates.map(v => v.toFixed(4)).join(', ');
    if (observerInput && subjectInput) {
      observerInput.value = observerCoordinateStr;
      subjectInput.value = subjectCoordinateStr;
    }
    this.bearing = getBearing(turfPoint(observerCoordinates), turfPoint(subjectCoordinates));
    this.distance = getDistance(turfPoint(observerCoordinates), turfPoint(subjectCoordinates));
  }

  async onSubmit(e: Event) {
    e.preventDefault();
    const form = this.shadowRoot!.querySelector('form') as HTMLFormElement;
    const data = new FormData(form);
    const observedAt = Temporal.PlainDate.from(this.date)
      .toZonedDateTime({timeZone: 'PST8PDT', plainTime: data.get('observed_time') as string})
      .epochMilliseconds;
    const sighting: SightingForm = {
      body: data.get('body') as string,
      count: parseInt(data.get('count') as string) || null,
      id: this.getAttribute('id')!,
      observed_at: observedAt / 1000,
      observer_location: toLonLat(this.#observerPoint.getCoordinates()) as [number, number],
      subject_location: toLonLat(this.#subjectPoint.getCoordinates()) as [number, number],
      taxon: data.get('taxon') as string,
      url: data.get('url') as string,
    };
    const request = new Request(form.action, {
      body: JSON.stringify(sighting),
      headers: {'Content-Type': 'application/json'},
      method: 'PUT',
    });
    this._saveTask.run([request]);
  }

  hide() {
    this.classList.remove('show');
  }

  show() {
    this.classList.add('show');
  }

  protected firstUpdated(_changedProperties: PropertyValues): void {
    const sightingProperties: SightingStyleProperties = {
      individuals: [],
      symbol: 'O',
    }
    const observerFeature = new Feature(this.#observerPoint);
    observerFeature.setId(`${this.id}/observer`);
    observerFeature.setProperties({individuals: [], symbol: undefined});
    observerFeature.setStyle(sighterStyle);

    const subjectFeature = new Feature(this.#subjectPoint);
    subjectFeature.setId(`${this.id}/subject`);
    subjectFeature.setProperties(sightingProperties);
    subjectFeature.setStyle(featureStyle);

    this.drawingSource.addFeatures([observerFeature, subjectFeature]);
    this.#observerPoint.on('change', this.onCoordinatesChanged.bind(this));
    this.#subjectPoint.on('change', this.onCoordinatesChanged.bind(this));
    this.onCoordinatesChanged();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "add-observation": AddObservation;
  }
}
