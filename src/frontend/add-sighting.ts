import { css, html, LitElement, svg, type PropertyValues } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import {Task} from '@lit/task';
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
import { doLogInContext, userContext } from "./identity.ts";
import type { User } from "@auth0/auth0-spa-js";
import drawingSourceContext from "./drawing-context.ts";
import mapContext from './map-context.ts';
import { LineString } from "ol/geom.js";
import { v7 } from "uuid";
import type Map from "ol/Map.js";
import PlacePoint from "./place-point.ts";
import { repeat } from "lit/directives/repeat.js";

const clickTargetIcon = svg`<path d="M468-240q-96-5-162-74t-66-166q0-100 70-170t170-70q97 0 166 66t74 162l-84-25q-13-54-56-88.5T480-640q-66 0-113 47t-47 113q0 57 34.5 100t88.5 56l25 84Zm48 158q-9 2-18 2h-18q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480v18q0 9-2 18l-78-24v-12q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93h12l24 78Zm305 22L650-231 600-80 480-480l400 120-151 50 171 171-79 79Z"/>`;
const locateMeIcon = svg`<path d="M440-42v-80q-125-14-214.5-103.5T122-440H42v-80h80q14-125 103.5-214.5T440-838v-80h80v80q125 14 214.5 103.5T838-520h80v80h-80q-14 125-103.5 214.5T520-122v80h-80Zm40-158q116 0 198-82t82-198q0-116-82-198t-198-82q-116 0-198 82t-82 198q0 116 82 198t198 82Zm0-120q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47Zm0-80q33 0 56.5-23.5T560-480q0-33-23.5-56.5T480-560q-33 0-56.5 23.5T400-480q0 33 23.5 56.5T480-400Zm0-80Z"/>`;

@customElement('add-sighting')
export default class AddSighting extends LitElement {
  @property({type: String, reflect: false})
  id: string = v7()

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

  @property()
  private thumbnails: string[] = []

  @consume({context: doLogInContext})
  private logIn!: () => Promise<boolean>;

  @consume({context: userContext, subscribe: true})
  private user: User | undefined;

  private _saveTask = new Task(this, {
    autoRun: false,
    task: async ([request]: [Request]) => {
      const response = await fetch(request);
      const data = (await response.json()) as SightingForm;
      const event = new CustomEvent('observation-created', {bubbles: true, composed: true, detail: data});
      this.dispatchEvent(event);
      this.form!.reset();
      this.id = v7();
      return data;
    },
  });

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
    label span {
      display: inline-block;
      vertical-align: top;
      width: 10em;
    }
    label:has(input[required]) span::after {
      content: ' *';
    }
    .inline-icon {
      height: 1rem;
      vertical-align: middle;
      width: 1rem;
    }
    .thumbnail {
      height: 4rem;
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

  @query('input[name=observer_location', true)
  private observerLocationInput: HTMLInputElement | undefined

  @query('input[name=subject_location', true)
  private subjectLocationInput: HTMLInputElement | undefined

  @query('input[name=photos', true)
  private photosInput: HTMLInputElement | undefined

  protected render() {
    return html`
      <form @submit=${this.onSubmit} @dragover=${this.onDragOver} @drop=${this.onDrop} action="/api/sightings/${this.id}">
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
          <input @change=${this.onObserverInputChange} type="text" name="observer_location" size="14" placeholder="lon, lat" required>
          <button @click=${this.placeObserver} title="Locate on map" type="button"><svg class="inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${clickTargetIcon}</svg></button>
          <button @click=${this.locateMe} ?disabled=${!('geolocation' in navigator)} title="My location" type="button"><svg class="inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${locateMeIcon}</svg></button>
        </label>
        <label>
          <span>Subject location</span>
          <input @change=${this.onSubjectInputChange} type="text" name="subject_location" size="14" placeholder="lon, lat" required>
          <button @click=${this.placeSubject} title="Locate on map" type="button"><svg class="inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${clickTargetIcon}</svg></button>
        </label>
        <label>
          <span>Notes</span>
          <textarea name="body" rows="3" cols="21"></textarea>
        </label>
        <label>
          <span>Photos</span>
          <input @change=${this.onFilesChanged} type="file" name="photos" accept="image/jpeg" multiple>
          <div class="thumbnails">
            ${repeat(this.thumbnails, src => src, src => html`
              <img class="thumbnail" src=${src}>
            `)}
          </div>
        </label>
        <div><em>* required field</em></div>
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

  private async locateMe() {
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
    const input = this.photosInput!;
    if (!transfer?.files.length)
      return;
    e.preventDefault();

    // https://stackoverflow.com/a/68182158
    for (const existingFile of input.files || []) {
      transfer.items.add(existingFile);
    }

    input.files = transfer.files;
    this.onFilesChanged();
  }

  async onFilesChanged() {
    const ExifReader = await import('exifreader');
    const input = this.photosInput!;
    const thumbnails: Promise<string>[] = [];
    for (const file of input.files!) {
      const {gps} = await ExifReader.load(file, {async: true, expanded: true});
      if (gps && gps.Latitude && gps.Longitude && this.#subjectPoint.getCoordinates().length === 0)
        this.#subjectPoint.setCoordinates(fromLonLat([gps.Longitude, gps.Latitude]));

      const promise = new Promise<string>(resolve => {
        const fileReader = new FileReader();
        fileReader.onload = () => resolve(fileReader.result as string);
        fileReader.readAsDataURL(file);
      });
      thumbnails.push(promise);
    }
    this.thumbnails = await Promise.all(thumbnails);
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
    if (!this.user) {
      if (! (await this.logIn()))
        return;
    }
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
      user: this.user!.sub!,
    };
    const request = new Request(form.action, {
      body: JSON.stringify(sighting),
      headers: {'Content-Type': 'application/json'},
      method: 'PUT',
    });
    this._saveTask.run([request]);
  }

  protected firstUpdated(_changedProperties: PropertyValues): void {
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
