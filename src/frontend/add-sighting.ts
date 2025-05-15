import { css, html, LitElement, type PropertyValues } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { fromLonLat, toLonLat } from "ol/proj.js";
import { bearing as getBearing } from "@turf/bearing";
import { point as turfPoint } from "@turf/helpers";
import { distance as getDistance } from '@turf/distance';
import Point from "ol/geom/Point.js";
import { consume } from "@lit/context";
import Feature from "ol/Feature.js";
import VectorSource from "ol/source/Vector.js";
import { bearingStyle, featureStyle, sighterStyle, type SightingStyleProperties } from "./style.ts";
import type { SightingForm } from "../types.ts";
import { Temporal } from "temporal-polyfill";
import { doLogInContext, tokenContext, userContext } from "./identity.ts";
import type { User } from "@auth0/auth0-spa-js";
import drawingSourceContext from "./drawing-context.ts";
import mapContext from './map-context.ts';
import { LineString } from "ol/geom.js";
import { v7 } from "uuid";
import type Map from "ol/Map.js";
import PlacePoint from "./place-point.ts";
import { repeat } from "lit/directives/repeat.js";
import { cameraAddIcon, clickTargetIcon, locateMeIcon } from "./icons.ts";
import {Task} from '@lit/task';
import './photo-uploader.ts';

@customElement('add-sighting')
export default class AddSighting extends LitElement {
  private _saveTask = new Task(this, {
    autoRun: false,
    task: async([request]: [Request]) => {
      const response = await fetch(request);
      const data = await response.json();
      this.form!.reset();
      const event = new CustomEvent('observation-created', {bubbles: true, composed: true, detail: this.id});
      this.dispatchEvent(event);
      return data;
    }
  });

  @property({type: String, reflect: false})
  id: string = v7()

  @property()
  private photos: File[] = []

  @property()
  private date!: string

  @consume({context: drawingSourceContext})
  private drawingSource: VectorSource | undefined

  @consume({context: mapContext})
  private map: Map | undefined

  #observerPoint = new Point([]);
  #subjectPoint = new Point([]);
  #bearingFeature = new Feature(new LineString([]));

  @property()
  private cancel!: () => void;

  @consume({context: doLogInContext})
  private logIn!: () => Promise<boolean>;

  @consume({context: userContext, subscribe: true})
  private user: User | undefined;

  @consume({context: tokenContext, subscribe: true})
  private token: string | undefined;

  private place: PlacePoint | undefined

  static styles = css`
    :host {
      display: block;
      font-family: Mukta,Helvetica,Arial,sans-serif;
    }
    form {
      padding: 0.5rem;
    }
    button {
      align-items: center;
      cursor: pointer;
      display: inline-flex;
      gap: 0.5rem;
      vertical-align: middle;
    }
    label {
      display: block;
    }
    label > span {
      display: inline-block;
      vertical-align: top;
      width: 10em;
    }
    label:has(input[required]) .label::after {
      content: ' *';
    }
    .inline-icon {
      height: 1rem;
      vertical-align: middle;
      width: 1rem;
    }
    input[name=photos] {
      display: none;
    }
    .thumbnails {
      display: inline-flex;
      gap: 0.5rem;
      width: 10em;
    }
    photo-uploader {
      height: 4rem;
    }
    .upload-photo {
      height: 4rem;
      width: 4rem;
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

  @query('form', true)
  private form: HTMLFormElement | undefined

  @query('input[name=observed_time]', true)
  private timeInput: HTMLInputElement | undefined

  @query('input[name=observer_location', true)
  private observerLocationInput: HTMLInputElement | undefined

  @query('input[name=subject_location', true)
  private subjectLocationInput: HTMLInputElement | undefined

  @query('input[name=photos', true)
  private photosInput: HTMLInputElement | undefined

  constructor() {
    super();

    this.addEventListener('coordinates-detected', (e) => {
      if (!(e instanceof CustomEvent) || !Array.isArray(e.detail))
        throw "Bad coordinates-detected event";

      if (this.#observerPoint.getCoordinates().length === 0)
        this.#observerPoint.setCoordinates(e.detail);
    });

    this.addEventListener('datetime-detected', (e) => {
      if (!(e instanceof CustomEvent) || typeof e.detail !== 'string')
        throw "Bad datetime-detected event";

      if (this.timeInput!.value === '') {
        this.timeInput!.value = e.detail.split(' ')[1] || '';
      }
    })
  }

  protected render() {
    return html`
      <input @change=${this.onFilesChanged} type="file" name="photos" accept="image/jpeg" multiple>
      <form @submit=${this.onSubmit} @dragover=${this.onDragOver} @drop=${this.onDrop} action="/api/sightings/${this.id}">
        <label>
          <span class="label">URL</span>
          <input type="url" name="url" />
        </label>
        <label>
          <span class="label">Species</span>
          <select name="taxon">
            <option value="Orcinus orca" selected>Killer Whale (any type)</option>
            <option value="Orcinus orca ater">Resident Killer Whale</option>
            <option value="Orcinus orca rectipinnus">Bigg's Killer Whale</option>
          </select>
        </label>
        <label>
          <span class="label">Count</span>
          <input type="number" name="count" value="" min="0" max="100">
        </label>
        <label>
          <span class="label">Time</span>
          <input type="time" name="observed_time" step="1" required />
        </label>
        <label>
          <span class="label">Observer location</span>
          <input @change=${this.onObserverInputChange} type="text" name="observer_location" size="14" placeholder="lon, lat" required>
          <button @click=${this.placeObserver} title="Locate on map" type="button"><svg class="inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${clickTargetIcon}</svg></button>
          <button @click=${this.locateMe} ?disabled=${!('geolocation' in navigator)} title="My location" type="button"><svg class="inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${locateMeIcon}</svg></button>
        </label>
        <label>
          <span class="label">Subject location</span>
          <input @change=${this.onSubjectInputChange} type="text" name="subject_location" size="14" placeholder="lon, lat" required>
          <button @click=${this.placeSubject} title="Locate on map" type="button"><svg class="inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${clickTargetIcon}</svg></button>
        </label>
        <label>
          <span class="label">Notes</span>
          <textarea name="body" rows="3" cols="21"></textarea>
        </label>
        <label>
          <span>Photos</span>
          <div class="thumbnails">
            ${repeat(this.photos, photo => photo, photo => html`
              <photo-uploader sightingId=${this.id} .file=${photo}>
                <input slot="input" type="hidden" name="photo" required>
              </photo-uploader>
            `)}
            <button @click=${this.onUploadClicked} class="upload-photo" type="button">
              <svg class="inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${cameraAddIcon}</svg>
              <span>Add</span>
            </button>
          </div>
        </label>
        <div class="actions">
          ${this._saveTask.render({
            initial: () => html`
              <output>&nbsp;</output>
              <button type="button" @click=${this.cancel}>Cancel</button>
              <button type="submit">Create</button>
            `,
            pending: () => html`
              <output>&nbsp;</output>
              <button type="button" @click=${this.cancel}>Cancel</button>
              <button type="submit" disabled>Create</button>
            `,
            complete: (_value: SightingForm) => html`
              <output class="success">Sighting created.</output>
              <button type="button" @click=${this.cancel}>Cancel</button>
              <button type="submit">Create</button>
            `,
            error: (error: unknown) => html`
              <output class="error">${error}</output>
              <button type="button" @click=${this.cancel}>Cancel</button>
              <button type="submit">Create</button>
            `
          })}
        </div>
      </form>
    `;
  }

  private locateMe() {
    const geo = navigator.geolocation;
    geo.getCurrentPosition(({coords: {latitude, longitude}}) => {
      this.#observerPoint.setCoordinates(fromLonLat([longitude, latitude]));
    }, error => {
      console.log(`Error reading location: ${error.message}`);
    }, {
      maximumAge: 1000 * 10,
      timeout: 1000 * 5,
      enableHighAccuracy: false,
    });
  }

  private onDragOver(e: DragEvent) {
    e.preventDefault();
  }

  private onDrop(e: DragEvent) {
    const transfer = e.dataTransfer;
    if (!transfer?.files.length)
      return;
    e.preventDefault();

    this.photos = [...this.photos, ...transfer.files];
  }

  private onFilesChanged() {
    if (!this.photosInput?.files)
      return;
    this.photos = [...this.photos, ...this.photosInput.files];
    this.photosInput.value = '';
  }

  private onUploadClicked() {
    this.photosInput!.click();
  }

  private placeObserver() {
    this.placePoint(this.#observerPoint);
  }

  private placeSubject() {
    this.placePoint(this.#subjectPoint);
  }

  private placePoint(point: Point) {
    if (this.place) {
      this.endPlacingPoint();
    } else {
      this.place = new PlacePoint({onComplete: this.endPlacingPoint.bind(this), point});
      this.map!.addInteraction(this.place);
    }
  }

  private endPlacingPoint() {
    if (this.place) {
      this.map!.removeInteraction(this.place);
      this.place = undefined;
    }
  }

  private onObserverInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const match = input.value.match(/^\s*(-[0-9]{3}.[0-9]+),\s*([0-9][0-9].[0-9]+)\s*$/);
    if (match) {
      const [, lon, lat] = match.map(v => parseFloat(v));
      this.#observerPoint.setCoordinates(fromLonLat([lon!, lat!]));
    }
  }

  private onSubjectInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const match = input.value.match(/^\s*(-[0-9]{3}.[0-9]+),\s*([0-9][0-9].[0-9]+)\s*$/);
    if (match) {
      const [, lon, lat] = match.map(v => parseFloat(v));
      // This triggers onCoordinatesChanged
      this.#subjectPoint.setCoordinates(fromLonLat([lon!, lat!]));
    }
  }

  private onCoordinatesChanged() {
    const observerCoordinates = toLonLat(this.#observerPoint.getCoordinates());
    const subjectCoordinates = toLonLat(this.#subjectPoint.getCoordinates());
    let observerCoordinateStr = observerCoordinates.map(v => v.toFixed(4)).join(', ');
    let subjectCoordinateStr = subjectCoordinates.map(v => v.toFixed(4)).join(', ');
    if (this.observerLocationInput && this.subjectLocationInput) {
      this.observerLocationInput.value = observerCoordinateStr;
      this.subjectLocationInput.value = subjectCoordinateStr;
    }
    if (observerCoordinates.length && subjectCoordinates.length) {
      let bearing = getBearing(turfPoint(observerCoordinates), turfPoint(subjectCoordinates));
      if (bearing < 0)
        bearing += 360;
      const distance = getDistance(turfPoint(observerCoordinates), turfPoint(subjectCoordinates));
      this.#bearingFeature.getGeometry()!.setCoordinates([this.#observerPoint.getCoordinates(), this.#subjectPoint.getCoordinates()]);
      this.#bearingFeature.setProperties({bearing, distance});
    } else {
      this.#bearingFeature.getGeometry()!.setCoordinates([]);
      this.#bearingFeature.setProperties({bearing: null, distance: null});
    }
  }

  private async onSubmit(e: Event) {
    e.preventDefault();
    if (!this.token) {
      if (! (await this.logIn()))
        return;
    }
    if (!this.token)
      throw "Tried to submit without a token";

    const form = this.shadowRoot!.querySelector('form') as HTMLFormElement;
    const formData = new FormData(form);
    const data: {[k: string]: unknown} = Object.fromEntries(formData);
    data.count = parseInt(formData.get('count') as string, 10);
    data.observed_at = Temporal.PlainDate.from(this.date)
      .toZonedDateTime({timeZone: 'PST8PDT', plainTime: data.observed_time as string})
      .epochMilliseconds / 1000;
    data.photo = formData.getAll('photo');
    data.observer_location = toLonLat(this.#observerPoint.getCoordinates());
    data.subject_location = toLonLat(this.#subjectPoint.getCoordinates());
    data.user = this.user!.sub!;
    const request = new Request(form.action, {
      body: JSON.stringify(data),
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      method: 'PUT',
    });
    this._saveTask.run([request]);
  }

  protected firstUpdated(_changedProperties: PropertyValues): void {
    this.addEventListener('reset', () => {console.log('reset'); this.id = v7()});

    const sightingProperties: SightingStyleProperties = {
      individuals: [],
      kind: 'Sighting',
      symbol: 'O',
    }
    const observerFeature = new Feature(this.#observerPoint);
    observerFeature.setId(`${this.id}/observer`);
    observerFeature.setProperties({individuals: [], kind: 'Sighter', symbol: undefined});
    observerFeature.setStyle(sighterStyle);

    const subjectFeature = new Feature(this.#subjectPoint);
    subjectFeature.setId(`${this.id}/subject`);
    subjectFeature.setProperties(sightingProperties);
    subjectFeature.setStyle(featureStyle);

    this.#bearingFeature.setStyle(feature => bearingStyle(feature as Feature<LineString>));

    this.drawingSource!.addFeatures([observerFeature, subjectFeature, this.#bearingFeature]);
    this.#observerPoint.on('change', this.onCoordinatesChanged.bind(this));
    this.#subjectPoint.on('change', this.onCoordinatesChanged.bind(this));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "add-sighting": AddSighting;
  }
}
