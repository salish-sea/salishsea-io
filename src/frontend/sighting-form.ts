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
import { type UpsertSightingResponse } from "../types.ts";
import { licenseCodes, salishSeaExtent } from '../constants.ts';
import { Temporal } from "temporal-polyfill";
import { tokenContext } from "./identity.ts";
import drawingSourceContext from "./drawing-context.ts";
import mapContext from './map-context.ts';
import { LineString } from "ol/geom.js";
import type Map from "ol/Map.js";
import PlacePoint from "./place-point.ts";
import { repeat } from "lit/directives/repeat.js";
import { cameraAddIcon, clickTargetIcon, locateMeIcon } from "./icons.ts";
import {Task} from '@lit/task';
import './photo-uploader.ts';
import { type SightingPayload } from "../api.ts";
import { TanStackFormController } from '@tanstack/lit-form';
import { convert as parseCoords } from 'geo-coordinates-parser';

const TAXON_OPTIONS = {
  "Seals and sea lions": {
    "Phoca vitulina richardii": "Harbor seal",
    "Eumetopias jubatus monteriensis": "Steller sea lion",
    "Zalophus californianus": "California sea lion",
    "Mirounga angustirostris": "Elephant seal",
  },
  "Dolphins and porpoises": {
    "Phoca vitulina richardii": "Harbor porpoise",
    "Phocoenoides dalli": "Dall's porpoise",
    "Sagmatias obliquidens": "Pacific white-sided dolphin",
  },
  "Killer whales": {
    "Orcinus orca": "Killer whale (unknown ecotype)",
    "Orcinus orca rectipinnus": "Bigg's killer whale",
    "Orcinus orca ater": "Resident killer whale",
  },
  "Baleen whales": {
    "Megaptera novaeangliae": "Humpback whale",
    "Eschrichtius robustus": "Gray whale",
    "Balaenoptera acutorostrata": "Minke whale",
    "Balaenoptera physalus": "Fin whale",
    "Physeter macrocephalus": "Sperm whale",
  },
  "Otters": {
    "Lontra canadensis": "River otter",
    "Enhydra lutris kenyoni": "Sea otter",
  },
};

const DIRECTION_OPTIONS = Object.freeze({
  "": "None or unknown",
  "north": "North",
  "northeast": "Northeast",
  "east": "East",
  "southeast": "Southeast",
  "south": "South",
  "southwest": "Southwest",
  "west": "West",
  "northwest": "Northwest",
});

const PHOTO_LICENSE_CHOICE_STORAGE_KEY = 'photoLicenseCode';
const TAXON_CHOICE_STORAGE_KEY = 'lastTaxon';

export type SightingFormData = {
  body: string;
  count: number;
  observed_time: string;
  observer_location: string;
  photo_license: string;
  photo_urls: string[];
  subject_location: string;
  taxon: string;
  travel_direction: string;
  url: string;
}
export function newSighting(initial?: Partial<SightingFormData> | undefined): SightingFormData {
  return {
    body: '',
    count: NaN,
    observed_time: '',
    observer_location: '',
    photo_license: localStorage.getItem(PHOTO_LICENSE_CHOICE_STORAGE_KEY) || 'cc-by',
    photo_urls: [],
    subject_location: '',
    taxon: localStorage.getItem(TAXON_CHOICE_STORAGE_KEY) || 'Orcinus orca',
    travel_direction: '',
    url: '',
    ...initial,
  };
}

function latLonInBoundsValidator(value: string) {
  if (value.indexOf(',') === -1)
    return "Expects coordinates like '47.6845, -122.3037'";
  try {
    const {decimalLatitude, decimalLongitude} = parseCoords(value, 4);
    const [minx, miny, maxx, maxy] = salishSeaExtent;
    if (decimalLatitude < miny || decimalLatitude > maxy)
      return `Expected a latitude between ${miny} and ${maxy}`;
    if (decimalLongitude < minx || decimalLongitude > maxx)
      return `Expected a latitude between ${minx} and ${maxx}`;
  } catch (e) {
    return "Couldn't interpret value as coordinates";
  }
}

@customElement('sighting-form')
export default class SightingForm extends LitElement {
  private _saveTask = new Task(this, {
    autoRun: false,
    task: async([request]: [Request]) => {
      const response = await fetch(request);
      const data: UpsertSightingResponse = await response.json();
      if (response.ok) {
        this.dispatchEvent(new CustomEvent('database-changed', {bubbles: true, composed: true}));
        this.dispatchEvent(new CustomEvent('sighting-saved', {bubbles: true, composed: true, detail: data.id}));
        return data;
      } else {
        throw response.statusText;
      }
    }
  });

  @property({type: String, reflect: false})
  id!: string

  @property()
  private photos: File[] = []

  #date = '';
  @property({type: String, reflect: true})
  set date(val: string) {
    this.#date = val;
    this.#form.api.validateField('observed_time', 'change');
  }
  get date() {
    return this.#date;
  }

  @property({attribute: false, type: Object})
  initialValues: Partial<SightingFormData> = {}

  @consume({context: drawingSourceContext})
  private drawingSource: VectorSource | undefined

  @consume({context: mapContext})
  private map: Map | undefined

  #observerPoint = new Point([]);
  #subjectPoint = new Point([]);
  #bearingFeature = new Feature(new LineString([]));

  @consume({context: tokenContext, subscribe: true})
  private token: string | undefined;

  private place: PlacePoint | undefined

  static styles = css`
    :host {
      display: block;
      font-family: Mukta,Helvetica,Arial,sans-serif;
    }
    form {
      line-height: 2;
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
    select {
      max-width: 12rem;
    }
    .field-error {
      color: red;
      text-align: right;
    }
    photo-uploader {
      height: 4rem;
    }
    .upload-photo {
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

  @query('input[name=observed_time]', true)
  private timeInput: HTMLInputElement | undefined

  @query('input[name=observer_location]', true)
  private observerLocationInput: HTMLInputElement | undefined

  @query('input[name=subject_location]', true)
  private subjectLocationInput: HTMLInputElement | undefined

  @query('input[name=photos]', true)
  private photosInput: HTMLInputElement | undefined

  #form = new TanStackFormController(this, {
    defaultValues: newSighting(),
    onSubmit: ({value}) => {
      const observedAt = Temporal.PlainDate.from(this.date).toZonedDateTime({timeZone: 'PST8PDT', plainTime: value.observed_time});
      const observerCoords = toLonLat(this.#observerPoint.getCoordinates())
      const subjectCoords = this.#subjectPoint.getCoordinates();
      if (subjectCoords.length !== 2)
        throw new Error("Subject coordinates not set");

      const payload: SightingPayload = {
        body: value.body,
        count: isNaN(value.count) ? null : value.count,
        direction: value.travel_direction,
        observed_at: observedAt.toInstant().toString(),
        observer_location: observerCoords.length === 2 ? observerCoords as [number, number] : null,
        photo_license: value.photo_license,
        photos: value.photo_urls,
        subject_location: toLonLat(subjectCoords) as [number, number],
        taxon: value.taxon,
        url: value.url,
      };
      const endpoint = `/api/sightings/${this.id}`;
      const request = new Request(endpoint, {
        body: JSON.stringify(payload),
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        method: 'PUT',
      });
      this._saveTask.run([request]);
      localStorage.setItem('lastTaxon', value.taxon);
    },
  })

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

      const [date, time] = e.detail.split(' ');
      if (time && this.timeInput!.value === '') {
        this.timeInput!.value = time;
        this.timeInput!.dispatchEvent(new Event('change'));
      }
      if (date !== this.date) {
        const dateSelected = new CustomEvent('date-selected', {bubbles: true, composed: true, detail: date});
        this.dispatchEvent(dateSelected);
      }
    })
  }

  protected render() {
    return html`
      <input @change=${this.onFilesChanged} type="file" name="photos" accept="image/jpeg" multiple>
      <form
        @submit=${(e: Event) => {
          e.preventDefault();
          this.#form.api.handleSubmit();
        }}
        @dragover=${this.onDragOver}
        @drop=${this.onDrop}
      >
        ${this.#form.field({name: 'url', validators: {onChange: ({value}) => {
          const trimmed = value.trim();
          if (trimmed.length === 0)
            return;
          const url = URL.parse(value);
          if (!url)
            return "Should start with https://...";
        }}}, field => html`
          <label>
            <span class="label">URL</span>
            <input type="url" name="${field.name}" .value=${field.state.value} @change=${(e: Event) => field.handleChange((e.target as HTMLInputElement).value)}>
          </label>
          ${field.state.meta.errors.map(err => html`<div class="field-error">${err}</div>`)}
        `)}
        ${this.#form.field({name: 'taxon'}, field => html`
          <label>
            <span class="label">Species</span>
            <select name="${field.name}" @change=${(e: Event) => {
              const scientificName = (e.target as HTMLSelectElement).value;
              field.handleChange(scientificName);
              localStorage.setItem(TAXON_CHOICE_STORAGE_KEY, scientificName);
            }}>
              ${Object.entries(TAXON_OPTIONS).map(([group, taxa]) => html`
                <optgroup label=${group}>${Object.entries(taxa).map(([taxon, label]) => html`
                  <option value=${taxon} ?selected=${taxon === field.state.value}>${label}</option>
                `)}</optgroup>
              `)}
            </select>
          </label>
        `)}
        ${this.#form.field({ name: 'count', }, field => html` <label>
            <span class="label">Count</span>
            <input type="number" name="${field.name}" .value=${field.state.value} min="0" max="100" @change=${(e: Event) => field.handleChange((e.target as HTMLInputElement).valueAsNumber)}>
          </label>
        `)}
        ${this.#form.field({
          name: 'observed_time',
          validators: {onChange: ({value}) => {
            const str = value.trim();
            const observedAt = Temporal.PlainDate.from(this.date)
              .toZonedDateTime({timeZone: 'PST8PDT', plainTime: str});
            if (Temporal.ZonedDateTime.compare(observedAt, Temporal.Now.zonedDateTimeISO()) > 0) {
              return "Must be in the past";
            }
          }},
        }, field => html`
          <label>
            <span class="label">Time</span>
            <input type="time" name="${field.name}" step="1" required .value=${field.state.value} @change=${(e: InputEvent) => field.handleChange((e.target as HTMLInputElement).value)}>
          </label>
          ${field.state.meta.errors.map(err => html`<div class="field-error">${err}</div>`)}
        `)}
        ${this.#form.field({
          name: 'observer_location',
          validators: {onChange: ({value}) => {
            const latLon = value.trim();
            if (latLon.length > 0)
              return latLonInBoundsValidator(latLon);
          }},
        }, field => html`
          <label>
            <span class="label">Observer location</span>
            <input type="text" name="${field.name}" size="14" placeholder="lat, lon" .value=${field.state.value} @change=${(e: InputEvent) => {
              field.handleChange((e.target as HTMLInputElement).value);
              this.onObserverInputChange(e);
            }}>
            <button @click=${this.placeObserver} title="Locate on map" type="button"><svg class="inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${clickTargetIcon}</svg></button>
            <button @click=${this.locateMe} ?disabled=${!('geolocation' in navigator)} title="My location" type="button"><svg class="inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${locateMeIcon}</svg></button>
          </label>
          ${field.state.meta.errors.map(err => html`<div class="field-error">${err}</div>`)}
        `)}
        ${this.#form.field({
          name: 'subject_location',
          validators: {onChange: ({value}) => latLonInBoundsValidator(value)},
        }, field => html`
          <label>
            <span class="label">Subject location</span>
            <input type="text" name="${field.name}" size="14" placeholder="lat, lon" required .value=${field.state.value} @change=${(e: InputEvent) => {
              field.handleChange((e.target as HTMLInputElement).value);
              this.onSubjectInputChange(e);
            }}>
            <button @click=${this.placeSubject} title="Locate on map" type="button"><svg class="inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${clickTargetIcon}</svg></button>
          </label>
          ${field.state.meta.errors.map(err => html`<div class="field-error">${err}</div>`)}
        `)}
        ${this.#form.field({name: 'travel_direction'}, field => html`
          <label>
            <span class="label">Travel direction</span>
            <select name="${field.name}" @change=${(e: Event) => field.handleChange((e.target as HTMLSelectElement).value)}>
              ${repeat(Object.entries(DIRECTION_OPTIONS), ([key]) => key, ([key, label]) => html`
                <option value=${key} ?selected=${key === field.state.value}>${label}</option>
              `)}
            </select>
          </label>
        `)}
        ${this.#form.field({name: 'body'}, field => html`
          <label>
            <span class="label">Notes</span>
            <textarea name="${field.name}" rows="3" cols="21" .value=${field.state.value} @change=${(e: Event) => field.handleChange((e.target as HTMLTextAreaElement).value)}></textarea>
          </label>
        `)}
        <label>
          <span>Photos</span>
          <div class="thumbnails">
            ${repeat(this.photos, photo => photo, (photo, index) => html`
              <photo-uploader expected-date=${this.date} sightingId=${this.id} .file=${photo}>
                ${this.#form.field({name: `photo_urls[${index}]`}, field => html`
                  <input slot="input" type="hidden" name=${field.name} required @change=${(e: Event) => {
                    const url = (e.target as HTMLInputElement).value;
                    field.handleChange(url);
                  }}>
                `)}
              </photo-uploader>
            `)}
            <button @click=${this.onUploadClicked} class="upload-photo" type="button">
              <svg class="inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${cameraAddIcon}</svg>
              <span>Add</span>
            </button>
          </div>
        </label>
        ${this.#form.field({name: 'photo_license'}, field => html`
          <label>
            <span class="label">Photo license</span>
            <select name="${field.name}" ?required=${this.photos.length > 0} @change=${(e: Event) => {
              const licenseCode = (e.target as HTMLSelectElement).value;
              field.handleChange(licenseCode);
              localStorage.setItem(PHOTO_LICENSE_CHOICE_STORAGE_KEY, licenseCode);
            }}>
              ${Object.entries(licenseCodes).map(([code, description]) => html`
                <option value=${code} ?selected=${code === field.state.value}>${description}</option>
              `)}
            </select>
          </label>
        `)}
        <div class="actions">
          ${this._saveTask.render({
            initial: () => html`
              <output>${this.#form.api.state.errorMap.onChange || html`&nbsp;`}</output>
              <button type="button" @click=${this.cancel}>Cancel</button>
              <button type="submit">Save</button>
            `,
            pending: () => html`
              <output>Saving…</output>
              <button type="button" @click=${this.cancel}>Cancel</button>
              <button type="submit" disabled>Save</button>
            `,
            complete: () => html`
              <output class="success">Sighting created.</output>
              <button type="button" @click=${this.cancel}>Cancel</button>
              <button type="submit">Save</button>
            `,
            error: (error: unknown) => html`
              <output class="error">${error}</output>
              <button type="button" @click=${this.cancel}>Cancel</button>
              <button type="submit">Save</button>
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
    try {
      const {decimalLatitude, decimalLongitude} = parseCoords(input.value, 4);
      this.#observerPoint.setCoordinates(fromLonLat([decimalLongitude, decimalLatitude]));
    } catch (e) {
      this.#observerPoint.setCoordinates([]);
    }
  }

  private onSubjectInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    try {
      const {decimalLatitude, decimalLongitude} = parseCoords(input.value, 4);
      this.#subjectPoint.setCoordinates(fromLonLat([decimalLongitude, decimalLatitude]));
    } catch (e) {
      this.#subjectPoint.setCoordinates([]);
    }
  }

  private onCoordinatesChanged() {
    const observerCoordinates = toLonLat(this.#observerPoint.getCoordinates());
    const subjectCoordinates = toLonLat(this.#subjectPoint.getCoordinates());
    let observerCoordinateStr = observerCoordinates.map(v => v.toFixed(4)).reverse().join(', ');
    let subjectCoordinateStr = subjectCoordinates.map(v => v.toFixed(4)).reverse().join(', ');
    if (this.observerLocationInput && this.subjectLocationInput) {
      if (this.observerLocationInput.value !== observerCoordinateStr) {
        this.observerLocationInput.value = observerCoordinateStr;
        this.observerLocationInput.dispatchEvent(new Event('change'));
      }

      if (this.subjectLocationInput.value !== subjectCoordinateStr) {
        this.subjectLocationInput.value = subjectCoordinateStr;
        this.subjectLocationInput.dispatchEvent(new Event('change'));
      }
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

  protected firstUpdated(_changedProperties: PropertyValues): void {
    for (const [field, value] of Object.entries(this.initialValues)) {
      this.#form.api.setFieldValue(field as keyof typeof this.initialValues, value);
    }

    const sightingProperties: SightingStyleProperties = {
      direction: null,
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

  cancel() {
    this.dispatchEvent(new Event('cancel-edit', {bubbles: true, composed: true}));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sighting-form": SightingForm;
  }
}
