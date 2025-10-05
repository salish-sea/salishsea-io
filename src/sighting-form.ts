import { css, html, LitElement, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { fromLonLat, toLonLat } from "ol/proj.js";
import { bearing as getBearing } from "@turf/bearing";
import { point as turfPoint } from "@turf/helpers";
import { distance as getDistance } from '@turf/distance';
import Point from "ol/geom/Point.js";
import { consume } from "@lit/context";
import Feature from "ol/Feature.js";
import VectorSource from "ol/source/Vector.js";
import { bearingStyle, occurrenceStyle, sighterStyle } from "./style.ts";
import { licenseCodes, salishSeaExtent } from './constants.ts';
import { Temporal } from "temporal-polyfill";
import drawingSourceContext from "./drawing-context.ts";
import mapContext from './map-context.ts';
import { LineString } from "ol/geom.js";
import type Map from "ol/Map.js";
import PlacePoint from "./place-point.ts";
import { repeat } from "lit/directives/repeat.js";
import {Task, TaskStatus} from '@lit/task';
import './photo-uploader.ts';
import { TanStackFormController } from '@tanstack/lit-form';
import { convert as parseCoords } from 'geo-coordinates-parser';
import { detectIndividuals } from "./identifiers.ts";
import { type License, type Occurrence, type TravelDirection, type UpsertObservationArgs } from "./supabase.ts";
import { supabase } from "./supabase.ts";
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/button-group/button-group.js';
import '@awesome.me/webawesome/dist/components/divider/divider.js';
import '@awesome.me/webawesome/dist/components/input/input.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';
import gapCss from '@awesome.me/webawesome/dist/styles/utilities/gap.css?raw';
import layoutCss from '@awesome.me/webawesome/dist/styles/utilities/layout.css?raw';

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
  photo_license: License;
  photo_urls: string[];
  subject_location: string;
  taxon: string;
  travel_direction: TravelDirection | '';
  url: string;
};
export function newSighting(): SightingFormData {
  return {
    body: '',
    count: NaN,
    observed_time: '',
    observer_location: '',
    photo_license: localStorage.getItem(PHOTO_LICENSE_CHOICE_STORAGE_KEY) as (License | null) || 'cc-by',
    photo_urls: [],
    subject_location: '',
    taxon: localStorage.getItem(TAXON_CHOICE_STORAGE_KEY) || 'Orcinus orca',
    travel_direction: '',
    url: '',
  };
}

function latLonInBoundsValidator(value: string) {
  if (value.trim().length === 0)
    return;
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
    task: async([occurrence]: [UpsertObservationArgs]) => {
      const {data, error} = await supabase.rpc('upsert_observation', occurrence as any);
      if (error) {
        throw new Error(`Error saving observation: ${error}`);
      }
      this.dispatchEvent(new CustomEvent('database-changed', {bubbles: true, composed: true}));
      this.dispatchEvent(new CustomEvent('sighting-saved', {bubbles: true, composed: true, detail: occurrence.up_id}));
      return data;
    }
  });

  @property({type: String, reflect: false})
  sightingId!: string

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

  #observerFeature = new Feature(new Point([]));
  #subjectFeature = new Feature(new Point([]));
  #bearingFeature = new Feature(new LineString([]));

  private place: PlacePoint | undefined

  static styles = css`
    ${unsafeCSS(layoutCss)}
    ${unsafeCSS(gapCss)}
    :host {
      display: block;
      font-family: Mukta,Helvetica,Arial,sans-serif;
    }
    form {
      padding: 0.5rem;
    }
    input[name=photos] {
      display: none;
    }
    .field-error {
      color: red;
      text-align: right;
    }
    photo-uploader {
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
      const [observerX, observerY] = toLonLat(this.#observerFeature.getGeometry()!.getCoordinates())
      const [subjectX, subjectY] = toLonLat(this.#subjectFeature.getGeometry()!.getCoordinates());
      if (!subjectX || !subjectY)
        throw new Error("Subject coordinates not set");

      const payload = {
        up_id: this.sightingId,
        body: value.body,
        count: isNaN(value.count) ? null : value.count,
        direction: value.travel_direction ? value.travel_direction : null,
        observed_at: observedAt.toInstant().toString(),
        observed_from: (observerX && observerY) ? {lon: observerX, lat: observerY} : null,
        photos: value.photo_urls.map(src => ({attribution: null, src, license: value.photo_license, mimetype: null, thumb: null})),
        location: {lon: subjectX, lat: subjectY},
        accuracy: null,
        taxon: {scientific_name: value.taxon, species_id: null, vernacular_name: null},
        url: value.url,
      };
      this._saveTask.run([payload]);
      localStorage.setItem('lastTaxon', value.taxon);
    },
  })

  constructor() {
    super();

    this.addEventListener('coordinates-detected', (e) => {
      if (!(e instanceof CustomEvent) || !Array.isArray(e.detail))
        throw "Bad coordinates-detected event";

      if (this.#observerFeature.getGeometry()!.getCoordinates().length === 0)
        this.#observerFeature.getGeometry()!.setCoordinates(e.detail);
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
        class="wa-stack"
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
            return "Should start with https://";
        }}}, field => html`
          <wa-input
            type="url"
            placeholder="Link to URL"
            name=${field.name}
            .value=${field.state.value}
            @change=${(e: Event) => field.handleChange((e.target as HTMLInputElement).value)}>
          </wa-input>
          ${field.state.meta.errors.map(err => html`<div class="field-error">${err}</div>`)}
        `)}
        ${this.#form.field({name: 'taxon'}, field => html`
          <wa-select
            placeholder="What did you see?"
            name=${field.name}
            .value=${field.state.value}
            @change=${(e: Event) => {
              const scientificName = (e.target as HTMLSelectElement).value;
              field.handleChange(scientificName);
              localStorage.setItem(TAXON_CHOICE_STORAGE_KEY, scientificName);
            }}>
            ${Object.entries(TAXON_OPTIONS)
              .map(([group, taxa]) => html`
                <small>${group}</small>
                ${Object.entries(taxa)
                  .map(([taxon, label]) => html`
                    <wa-option value=${taxon}>${label}</wa-option>
                `)}
              `)
            }
          </wa-select>
        `)}
        ${this.#form.field({ name: 'count', }, field => html`
          <wa-input
            placeholder="How many?"
            type="number"
            name="${field.name}"
            .value=${field.state.value}
            min="1"
            max="100"
            @change=${(e: Event) => field.handleChange((e.target as HTMLInputElement).valueAsNumber)}>
          </wa-input>
        `)}
        ${this.#form.field({
          name: 'observed_time',
          validators: {onChange: ({value}) => {
            const str = value.trim();
            if (str.length === 0)
              return;
            try {
              const observedAt = Temporal.PlainDate.from(this.date)
                .toZonedDateTime({timeZone: 'PST8PDT', plainTime: str});
              if (Temporal.ZonedDateTime.compare(observedAt, Temporal.Now.zonedDateTimeISO()) > 0) {
                return "Must be in the past";
              }
            } catch (e) {
              return `Couldn't interpret timestamp: ${e}`;
            }
          }},
        }, field => html`
          <wa-input
            type="time"
            name="${field.name}"
            step="1"
            required
            .value=${field.state.value}
            @change=${(e: InputEvent) => field.handleChange((e.target as HTMLInputElement).value)}>
          </wa-input
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
          <wa-input
            placeholder="Observer location"
            name="${field.name}"
            .value=${field.state.value} @change=${(e: InputEvent) => {
              const value = (e.target as HTMLInputElement).value;
              field.handleChange(value);
              this.onObserverInputChange(value);
            }}>
            <wa-button-group slot="end">
              <wa-button size="small" appearance="plain" @click=${this.placeObserver}>
                <wa-icon label="Place on map" name="location-dot"></wa-icon>
              </wa-button>
              <wa-button size="small" appearance="plain" @click=${this.locateMe} ?disabled=${!('geolocation' in navigator)}>
                <wa-icon label="My location" name="location-arrow"></wa-icon>
              </wa-button>
            </wa-button-group>
          </wa-input>
          ${field.state.meta.errors.map(err => html`<div class="field-error">${err}</div>`)}
        `)}
        ${this.#form.field({
          name: 'subject_location',
          validators: {onChange: ({value}) => {
            const latLon = value.trim();
            if (latLon.length > 0)
              return latLonInBoundsValidator(latLon);
          }},
        }, field => html`
          <wa-input
            placeholder="Subject location"
            name=${field.name}
            size="14"
            required
            .value=${field.state.value}
            @change=${(e: InputEvent) => {
              const value = (e.target as HTMLInputElement).value;
              field.handleChange(value)
              this.onSubjectInputChange(value);
            }}>
            <wa-button-group slot="end">
              <wa-button size="small" appearance="plain" @click=${this.placeSubject}>
                <wa-icon label="Locate on map" name="location-dot"></wa-icon>
              </wa-button>
            </wa-button-group>
          </wa-input>
          ${field.state.meta.errors.map(err => html`<div class="field-error">${err}</div>`)}
        `)}
        ${this.#form.field({name: 'travel_direction'}, field => html`
          <wa-select
            name="${field.name}"
            label="Which way were they headed?"
            @change=${(e: Event) => field.handleChange((e.target as HTMLSelectElement).value as TravelDirection)}>
            ${repeat(Object.entries(DIRECTION_OPTIONS), ([key]) => key, ([key, label]) => html`
              <wa-option value=${key} ?selected=${key === field.state.value}>${label}</wa-option>
            `)}
          </wa-select>
        `)}
        ${this.#form.field({name: 'body'}, field => html`
          <wa-textarea
            placeholder="Notes"
            name=${field.name}
            rows="3"
            .value=${field.state.value}
            @change=${(e: Event) => field.handleChange((e.target as HTMLTextAreaElement).value)}>
          </wa-textarea>
        `)}
        <div class="wa-cluster wa-gap-2xs">
          ${repeat(this.photos, photo => photo, (photo, index) => html`
            <photo-uploader expected-date=${this.date} sightingId=${this.sightingId} .file=${photo}>
              ${this.#form.field({name: `photo_urls[${index}]`}, field => html`
                <input slot="input" type="hidden" name=${field.name} required @change=${(e: Event) => {
                  const url = (e.target as HTMLInputElement).value;
                  field.handleChange(url);
                }}>
              `)}
            </photo-uploader>
          `)}
        </div>
        <wa-button @click=${this.onUploadClicked} style="align-self: start">
          <wa-icon name="camera" slot="start"></wa-icon>
          Add photo
        </wa-button>
        ${this.#form.field({name: 'photo_license'}, field => html`
          <wa-select
            label="Photo license"
            name="${field.name}"
            ?required=${this.photos.length > 0}
            @change=${(e: Event) => {
              const licenseCode = (e.target as HTMLSelectElement).value;
              field.handleChange(licenseCode as License);
              localStorage.setItem(PHOTO_LICENSE_CHOICE_STORAGE_KEY, licenseCode);
            }}>
            ${Object.entries(licenseCodes).map(([code, description]) => html`
              <wa-option value=${code} ?selected=${code === field.state.value}>${description}</wa-option>
            `)}
          </wa-select>
        `)}
        <output>${this._saveTask.render({
          initial: () => html`&nbsp;`,
          pending: () => html`Saving…`,
          complete: () => html`Sighting saved`,
          error: (error: unknown) => html`${error}`,
        })}</output>
        <wa-button-group style="align-self: end">
          <wa-button type="button" @click=${this.cancel}>Cancel</wa-button>
          <wa-button type="submit" ?disabled=${this._saveTask.status === TaskStatus.PENDING}>Save</wa-button>
        </wa-button-group>
      </form>
    `;
  }

  private locateMe() {
    const geo = navigator.geolocation;
    geo.getCurrentPosition(({coords: {latitude, longitude}}) => {
      this.#observerFeature.getGeometry()!.setCoordinates(fromLonLat([longitude, latitude]));
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
    this.placePoint(this.#observerFeature.getGeometry()!);
  }

  private placeSubject() {
    this.placePoint(this.#subjectFeature.getGeometry()!);
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

  private onObserverInputChange(value: string) {
    try {
      const {decimalLatitude, decimalLongitude} = parseCoords(value, 4);
      this.#observerFeature.getGeometry()!.setCoordinates(fromLonLat([decimalLongitude, decimalLatitude]));
    } catch (e) {
      this.#observerFeature.getGeometry()!.setCoordinates([]);
    }
  }

  private onSubjectInputChange(value: string) {
    if (value.trim() === '') {
      this.#subjectFeature.getGeometry()!.setCoordinates([]);
      return;
    }
    try {
      const {decimalLatitude, decimalLongitude} = parseCoords(value, 4);
      this.#subjectFeature.getGeometry()!.setCoordinates(fromLonLat([decimalLongitude, decimalLatitude]));
    } catch (e) {
      this.#subjectFeature.getGeometry()!.setCoordinates([]);
    }
  }

  private onCoordinatesChanged() {
    const observerCoordinates = toLonLat(this.#observerFeature.getGeometry()!.getCoordinates());
    const subjectCoordinates = toLonLat(this.#subjectFeature.getGeometry()!.getCoordinates());
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
      this.#bearingFeature.getGeometry()!.setCoordinates([
        this.#observerFeature.getGeometry()!.getCoordinates(),
        this.#subjectFeature.getGeometry()!.getCoordinates()
      ]);
      this.#bearingFeature.setProperties({bearing, distance});
    } else {
      this.#bearingFeature.getGeometry()!.setCoordinates([]);
      this.#bearingFeature.setProperties({bearing: null, distance: null});
    }
  }

  protected firstUpdated(_changedProperties: PropertyValues): void {
    for (const [field, value] of Object.entries(this.initialValues)) {
      const typedField = field as keyof typeof this.initialValues;
      if (typedField === 'photo_urls') {
        // TODO: rainhead
        // const typedValue = value as SightingFormData[typeof typedField];
        // typedValue.forEach((photo_url, index) => this.#form.api.setFieldValue(`photo_urls[${index}]`, photo_url);
      } else {
        const typedValue = value as SightingFormData[typeof typedField];
        this.#form.api.setFieldValue(typedField, typedValue);
      }
    }
    this.onSubjectInputChange(this.initialValues.subject_location || '');

    this.#form.api.baseStore.subscribe(this.updateSubjectProps.bind(this));

    const sightingProperties = newSighting();
    this.#observerFeature.setId(`${this.sightingId}/observer`);
    this.#observerFeature.setProperties({identifiers: [], kind: 'Sighter'});
    this.#observerFeature.setStyle(sighterStyle);

    this.#subjectFeature.setId(this.sightingId);
    this.#subjectFeature.setProperties(sightingProperties);
    this.updateSubjectProps();
    this.#subjectFeature.setStyle((f) => occurrenceStyle(f.getProperties() as Occurrence, false));
    this.updateSubjectProps();

    this.#bearingFeature.setStyle(feature => bearingStyle(feature as Feature<LineString>));

    this.drawingSource!.addFeatures([this.#observerFeature, this.#subjectFeature, this.#bearingFeature]);
    this.#observerFeature.getGeometry()!.on('change', this.onCoordinatesChanged.bind(this));
    this.#subjectFeature.getGeometry()!.on('change', this.onCoordinatesChanged.bind(this));
  }

  disconnectedCallback(): void {
    this.drawingSource!.removeFeatures([this.#observerFeature, this.#subjectFeature, this.#bearingFeature]);
  }

  updateSubjectProps() {
    const values = this.#form.api.baseStore.state.values;
    this.#subjectFeature.setProperties({
      direction: values.travel_direction,
      identifiers: detectIndividuals(values.body),
      // symbol: symbolFor({body: values.body, }) || '?',
      taxon: {scientific_name: values.taxon, vernacular_name: null},
    });
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
