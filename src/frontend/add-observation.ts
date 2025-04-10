import { css, html, LitElement, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
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

  observerInputRef = createRef<HTMLInputElement>();
  subjectInputRef = createRef<HTMLInputElement>();

  static styles = css`
    :host {
      background-color: rgba(128, 128, 128, 0.1);
      border: 1px solid gray;
      border-radius: 0.5rem;
      display: block;
      padding: 0.5rem;
    }
    form {
      display: none;
    }
    :host(.show) form {
      display: block;
    }
    :host(.show) [name=show] {
      display: none;
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
  `;

  protected render() {
    return html`
      <button @click=${this.show} name="show">Add an observation</button>
      <form @submit=${this.onSubmit} action="/observations/${this.id}" method="post">
        <label>
          <span>URL</span>
          <input type="url" name="url" />
        </label>
        <label>
          <span>Species</span>
          <select name="taxon">
            <option value="Orcinus orca" selected>Orca</option>
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
          <button type="button" @click=${this.hide}>Cancel</button>
          <button type="submit">Create</button>
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

  onSubmit(e: Event) {
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
      individuals: [],
      observed_at: observedAt / 1000,
      observer_location: toLonLat(this.#observerPoint.getCoordinates()) as [number, number],
      subject_location: toLonLat(this.#subjectPoint.getCoordinates()) as [number, number],
      taxon: data.get('taxon') as string,
      url: data.get('url') as string,
    };
    const event = new CustomEvent('create-sighting', {bubbles: true, composed: true, detail: sighting})
    this.dispatchEvent(event);
    console.log(event);
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
