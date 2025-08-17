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
import { licenseCodes } from '../constants.ts';
import { Temporal } from "temporal-polyfill";
import { tokenContext } from "./identity.ts";
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
import { type SightingPayload } from "../server/sighting.ts";
import { TanStackFormController } from '@tanstack/lit-form';

const taxa = {
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

@customElement('add-sighting')
export default class AddSighting extends LitElement {
  private _saveTask = new Task(this, {
    autoRun: false,
    task: async([request]: [Request]) => {
      const response = await fetch(request);
      const data: UpsertSightingResponse = await response.json();
      if (response.ok) {
        const event = new CustomEvent('database-changed', {bubbles: true, composed: true});
        this.dispatchEvent(event);
        this.reset();
        return data;
      } else {
        throw response.statusText;
      }
    }
  });

  @property({type: String, reflect: false})
  id: string = v7()

  @property()
  private photos: File[] = []

  @property({type: String, reflect: true})
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

  #form = new TanStackFormController(this, {
    defaultValues: {
      body: '',
      count: 0,
      observed_time: '',
      observer_location: '',
      photo_license: localStorage.getItem('photoLicenseCode') || 'cc-by',
      subject_location: '',
      taxon: localStorage.getItem('lastTaxon') || 'Orcinus orca',
      travel_direction: '',
      url: '',
    },
    onSubmit: ({value}) => {
      const observedAt = Temporal.PlainDate.from(this.date)
        .toZonedDateTime({timeZone: 'PST8PDT', plainTime: value.observed_time as string});
      if (Temporal.ZonedDateTime.compare(observedAt, Temporal.Now.zonedDateTimeISO()) > 0) {
        alert("Please ensure you've entered a time in the past");
        return;
      }
      // data.photo = formData.getAll('photo');
      const observerCoords = toLonLat(this.#observerPoint.getCoordinates())
      const subjectCoords = toLonLat(this.#subjectPoint.getCoordinates());
      const payload: SightingPayload = {
        body: value.body,
        count: value.count,
        direction: value.travel_direction,
        observed_at: observedAt.toInstant.toString(),
        observer_location: observerCoords.length === 2 ? observerCoords as [number, number] : null,
        photo: [],
        photo_license: value.photo_license,
        subject_location: subjectCoords as [number, number],
        taxon: value.taxon,
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
        ${this.#form.field({name: 'url'}, field => html`
          <label>
            <span class="label">URL</span>
            <input type="url" name="${field.name}" .value=${field.state.value} @change=${(e: Event) => field.handleChange((e.target as HTMLInputElement).value)}>
          </label>
        `)}
        ${this.#form.field({name: 'taxon'}, field => html`
          <label>
            <span class="label">Species</span>
            <select @change=${field.handleChange} name="${field.name}" .value=${field.state.value}>
              ${Object.entries(taxa).map(([group, taxa]) => html`
                <optgroup label=${group}>${Object.entries(taxa).map(([taxon, label]) => html`
                  <option value=${taxon}>${label}</option>
                `)}</optgroup>
              `)}
            </select>
          </label>
        `)}
        ${this.#form.field({name: 'count'}, field => html`
          <label>
            <span class="label">Count</span>
            <input type="number" name="${field.name}" .value=${field.state.value} min="0" max="100" @change=${(e: Event) => field.handleChange((e.target as HTMLInputElement).valueAsNumber)}>
          </label>
        `)}
        ${this.#form.field({name: 'observed_time'}, field => html`
          <label>
            <span class="label">Time</span>
            <input type="time" name="${field.name}" step="1" required .value=${field.state.value} @change=${(e: InputEvent) => field.handleChange((e.target as HTMLInputElement).value)}>
          </label>
        `)}
        ${this.#form.field({name: 'observer_location'}, field => html`
          <label>
            <span class="label">Observer location</span>
            <input type="text" name="${field.name}" size="14" placeholder="lat, lon" .value=${field.state.value} @change=${(e: InputEvent) => {
              field.handleChange((e.target as HTMLInputElement).value);
              this.onObserverInputChange(e);
            }}>
            <button @click=${this.placeObserver} title="Locate on map" type="button"><svg class="inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${clickTargetIcon}</svg></button>
            <button @click=${this.locateMe} ?disabled=${!('geolocation' in navigator)} title="My location" type="button"><svg class="inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${locateMeIcon}</svg></button>
          </label>
        `)}
        ${this.#form.field({name: 'subject_location'}, field => html`
          <label>
            <span class="label">Subject location</span>
            <input type="text" name="${field.name}" size="14" placeholder="lat, lon" required .value=${field.state.value} @change=${(e: InputEvent) => {
              field.handleChange((e.target as HTMLInputElement).value);
              this.onSubjectInputChange(e);
            }}>
            <button @click=${this.placeSubject} title="Locate on map" type="button"><svg class="inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${clickTargetIcon}</svg></button>
          </label>
        `)}
        ${this.#form.field({name: 'travel_direction'}, field => html`
          <label>
            <span class="label">Travel direction</span>
            <select name="${field.name}" .value=${field.state.value} @change=${(e: Event) => field.handleChange((e.target as HTMLSelectElement).value)}>
              <option value="">None or unknown</option>
              <option value="north">North</option>
              <option value="northeast">Northeast</option>
              <option value="east">East</option>
              <option value="southeast">Southeast</option>
              <option value="south">South</option>
              <option value="southwest">Southwest</option>
              <option value="west">West</option>
              <option value="northwest">Northwest</option>
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
            ${repeat(this.photos, photo => photo, photo => html`
              <photo-uploader expected-date=${this.date} sightingId=${this.id} .file=${photo}>
                <input slot="input" type="hidden" name="photo" required>
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
            <select @change=${this.onLicenseChange} name="${field.name}" .value=${field.state.value} @change=${(e: Event) => field.handleChange((e.target as HTMLSelectElement).value)}>
              ${Object.entries(licenseCodes).map(([code, description]) => html`
                <option value=${code}>${description}</option>
              `)}
            </select>
          </label>
        `)}
        <div class="actions">
          ${this._saveTask.render({
            initial: () => html`
              <output>&nbsp;</output>
              <button type="button" @click=${this.onCancel}>Cancel</button>
              <button type="submit">Create</button>
            `,
            pending: () => html`
              <output>&nbsp;</output>
              <button type="button" @click=${this.cancel}>Cancel</button>
              <button type="submit" disabled>Create</button>
            `,
            complete: () => html`
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

  private onCancel() {
    this.reset();
    this.cancel();
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

  private onLicenseChange(e: Event) {
    if (!(e.target instanceof HTMLSelectElement))
      throw `onLicenseChange is broken`;
    const licenseCode = e.target.value;
    localStorage.setItem('photoLicenseCode', licenseCode);
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
    const match = input.value.match(/^\s*([0-9]{2}.[0-9]+),\s*(-\d{3}.[0-9]+)\s*$/);
    if (match) {
      const [, lat, lon] = match.map(v => parseFloat(v));
      this.#observerPoint.setCoordinates(fromLonLat([lon!, lat!]));
    } else {
      this.#observerPoint.setCoordinates([]);
    }
  }

  private onSubjectInputChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const match = input.value.match(/^\s*(\d{2}.[0-9]+),\s*(-\d{3}.[0-9]+)\s*$/);
    if (match) {
      const [, lat, lon] = match.map(v => parseFloat(v));
      // This triggers onCoordinatesChanged
      this.#subjectPoint.setCoordinates(fromLonLat([lon!, lat!]));
    } else {
      this.#subjectPoint.setCoordinates([]);
    }
  }

  private onCoordinatesChanged() {
    const observerCoordinates = toLonLat(this.#observerPoint.getCoordinates());
    const subjectCoordinates = toLonLat(this.#subjectPoint.getCoordinates());
    let observerCoordinateStr = observerCoordinates.map(v => v.toFixed(4)).reverse().join(', ');
    let subjectCoordinateStr = subjectCoordinates.map(v => v.toFixed(4)).reverse().join(', ');
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

  protected firstUpdated(_changedProperties: PropertyValues): void {
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

  // public setProperties(props: Partial<SightingForm>) {
  //   // this.
  // }

  disconnectedCallback(): void {
    this.reset();
    super.disconnectedCallback();
  }

  private reset() {
    this.form!.reset();
    this.#observerPoint.setCoordinates([]);
    this.#subjectPoint.setCoordinates([]);
    this.photos = [];
    this.id = v7();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "add-sighting": AddSighting;
  }
}
