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
import { bearingStyle, occurrenceStyle, sighterStyle } from "./style.ts";
import { licenseCodes, acartiaExtent } from './constants.ts';
import { Temporal } from "temporal-polyfill";
import drawingSourceContext from "./drawing-context.ts";
import mapContext from './map-context.ts';
import { LineString } from "ol/geom.js";
import type Map from "ol/Map.js";
import PlacePoint from "./place-point.ts";
import { repeat } from "lit/directives/repeat.js";
import {createRef, ref} from 'lit/directives/ref.js';
import { cameraAddIcon, clickTargetIcon, locateMeIcon } from "./icons.ts";
import {Task} from '@lit/task';
import './photo-attachment.ts';
import { TanStackFormController } from '@tanstack/lit-form';
import { convert as parseCoords } from 'geo-coordinates-parser';
import { detectIndividuals } from "./identifiers.ts";
import { type License, type Occurrence, type TravelDirection, type UpsertObservationArgs } from "./types.ts";
import { supabase } from "./supabase.ts";
import { fetchAnimalNames } from "./catalog.ts";
import { reportError } from "./report-error.ts";
import { geolocationErrorIsReportable, geolocationMessage } from "./geolocation-message.ts";
import PhotoAttachment, { newPhotoId, photoThumbnail, readExif, uploadPhoto, type FailedUploadPhoto, type Photo, type UploadedPhoto } from "./photo-attachment.ts";
import type { Coordinate } from "ol/coordinate.js";


/**
 * What the form offers, by register entity (salish-53t.3). The labels come from the register
 * at runtime (public.animal_names), so nothing here names an animal: decision 033 keys on
 * `SSA:`, never on a name, and a list of our own labels drifts from the register the first
 * time it renames something. The group headings are ours — a way of laying out a menu, not
 * a claim about taxonomy ("Baleen whales" holds a sperm whale).
 *
 * Harbour seal, Steller sea lion and sea otter were iNaturalist subspecies here until the
 * register became the dictionary; it holds the species, so that is what a sighting records.
 */
const ENTITY_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  "Seals and sea lions": [
    "SSA:0000904", // Phoca vitulina
    "SSA:0000902", // Eumetopias jubatus
    "SSA:0000903", // Zalophus californianus
    "SSA:0000917", // Mirounga angustirostris
  ],
  "Dolphins and porpoises": [
    "SSA:0000912", // Phocoena phocoena
    "SSA:0000913", // Phocoenoides dalli
    "SSA:0000914", // Aethalodelphis obliquidens
  ],
  "Killer whales": [
    "SSA:0000900", // Orcinus orca, ecotype unknown
    "SSA:0000002", // Bigg's
    "SSA:0000003", // Resident
  ],
  "Baleen whales": [
    "SSA:0000901", // Megaptera novaeangliae
    "SSA:0000905", // Eschrichtius robustus
    "SSA:0000915", // Balaenoptera acutorostrata
    "SSA:0000916", // Balaenoptera physalus
    "SSA:0000921", // Physeter macrocephalus
  ],
  "Otters": [
    "SSA:0000906", // Lontra canadensis
    "SSA:0000918", // Enhydra lutris
  ],
};
const OFFERED_ENTITIES = new Set(Object.values(ENTITY_OPTIONS).flat());
const DEFAULT_ENTITY = "SSA:0000900";


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
// A new key, not 'lastTaxon': that one holds a scientific name from before salish-53t.3.
const ENTITY_CHOICE_STORAGE_KEY = 'lastEntity';
/** The last species this browser reported, if it is still one the form offers. */
function lastEntityChoice(): string {
  const stored = localStorage.getItem(ENTITY_CHOICE_STORAGE_KEY);
  return stored && OFFERED_ENTITIES.has(stored) ? stored : DEFAULT_ENTITY;
}

export type SightingFormData = {
  body: string;
  count: number;
  observed_time: string;
  observer_location: string;
  photo_license: License;
  photos: Photo[];
  subject_location: string;
  entity_id: string;
  travel_direction: TravelDirection | '';
  url: string;
};
function getPhotoLicense() {
  return localStorage.getItem(PHOTO_LICENSE_CHOICE_STORAGE_KEY) as (License | null) || 'cc-by';
}
export function newSighting(): SightingFormData {
  return {
    body: '',
    count: NaN,
    observed_time: '',
    observer_location: '',
    photo_license: getPhotoLicense(),
    photos: [],
    subject_location: '',
    entity_id: lastEntityChoice(),
    travel_direction: '',
    url: '',
  };
}
export function observationToFormData(observation: Occurrence): SightingFormData & {id: string} {
  const observedAt = Temporal.Instant.from(observation.observed_at).toZonedDateTimeISO('PST8PDT').toPlainDateTime();
  return {
    body: observation.body || '',
    count: observation.count || NaN,
    id: observation.id,
    observed_time: observedAt.toPlainTime().toString(),
    observer_location: observation.observed_from ? `${observation.observed_from.lat.toFixed(4)}, ${observation.observed_from.lon.toFixed(4)}` : '',
    photo_license: observation.photos[0]?.license || getPhotoLicense(),
    photos: observation.photos.map(photo => ({id: newPhotoId(), state: 'attached' as const, thumb: photo.thumb || photo.src, url: photo.src})),
    subject_location: `${observation.location.lat.toFixed(4)}, ${observation.location.lon.toFixed(4)}`,
    entity_id: observation.taxon.entity_id ?? DEFAULT_ENTITY,
    travel_direction: observation.direction || '',
    url: observation.url || '',
  }
}

/**
 * Validates the "lat, lon" text a person types into either coordinate field.
 * Exported for tests: the message is the whole product of this function, and
 * naming the wrong axis in it sends someone to check a number that is fine.
 */
export function latLonInBoundsValidator(value: string) {
  if (value.trim().length === 0)
    return;
  if (value.indexOf(',') === -1)
    return "Expects coordinates like '47.6845, -122.3037'";
  try {
    const {decimalLatitude, decimalLongitude} = parseCoords(value, 4);
    const [minx, miny, maxx, maxy] = acartiaExtent;
    if (decimalLatitude < miny || decimalLatitude > maxy)
      return `Expected a latitude between ${miny} and ${maxy}`;
    if (decimalLongitude < minx || decimalLongitude > maxx)
      return `Expected a longitude between ${minx} and ${maxx}`;
  } catch (e) {
    return "Couldn't interpret value as coordinates";
  }
}

@customElement('sighting-form')
export default class SightingForm extends LitElement {
  private _saveTask = new Task(this, {
    autoRun: false,
    task: async([occurrence]: [UpsertObservationArgs]) => {
      const {data, error} = await supabase().rpc('upsert_observation', occurrence);
      if (error) {
        throw new Error(`Error saving observation: ${error}`);
      }
      this.dispatchEvent(new CustomEvent('sighting-saved', {bubbles: true, composed: true, detail: occurrence}));
      return data;
    }
  });

  /** The register's names for what the form offers; the menu shows ids until they arrive. */
  private _namesTask = new Task(this, {
    task: () => fetchAnimalNames([...OFFERED_ENTITIES]),
    args: () => [],
    onComplete: () => this.updateSubjectProps(),
    onError: error => reportError(this, "Couldn't load species names; the menu shows identifiers instead.", {cause: error}),
  });

  @property({type: String, reflect: false})
  sightingId!: string

  @property()
  private photos: Photo[] = []

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
    :host {
      display: block;
      font-family: Mukta,Helvetica,Arial,sans-serif;
    }
    form {
      line-height: 1.4;
      padding: 0.5rem;
    }
    button {
      align-items: center;
      cursor: pointer;
      display: inline-flex;
      gap: 0.25rem;
      min-height: 1.5rem;
      padding: 0.25rem 0.5rem;
      vertical-align: middle;
      border: 1px solid var(--slate-300);
      border-radius: 4px;
      background: white;
      font-size: 0.75rem;
    }
    button:hover:not(:disabled) {
      background: #f5f5f5;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    label {
      display: grid;
      grid-template-columns: 7em 1fr;
      gap: 0.5rem;
      align-items: start;
      margin-bottom: 0.5rem;
    }
    label > span {
      font-weight: 500;
      font-size: 0.8125rem;
      padding-top: 0.375rem;
    }
    label:has(input[required]) .label::after {
      content: ' *';
      color: #d32f2f;
    }
    input[type="text"],
    input[type="url"],
    input[type="time"],
    input[type="number"],
    select,
    textarea {
      box-sizing: border-box;
      max-width: 100%;
      padding: 0.375rem 0.5rem;
      border: 1px solid var(--slate-300);
      border-radius: 4px;
      font-family: inherit;
      font-size: 0.8125rem;
    }
    input[type="number"] {
      width: 5em;
    }
    input[type="text"],
    input[type="url"],
    input[type="time"],
    select {
      width: 100%;
    }
    textarea {
      width: 100%;
      resize: vertical;
      min-height: 3rem;
      grid-column: 1 / -1;
    }
    .inline-icon {
      height: 1rem;
      vertical-align: middle;
      width: 1rem;
    }
    input[name=photos] {
      display: none;
    }
    .input-with-buttons {
      display: flex;
      gap: 0.25rem;
      align-items: center;
    }
    .input-with-buttons input {
      flex: 1;
      min-width: 0;
    }
    .input-with-buttons button {
      flex-shrink: 0;
    }
    .thumbnails {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      grid-column: 2;
    }
    select {
      max-width: 100%;
    }
    .field-error {
      color: #d32f2f;
      font-size: 0.6875rem;
      margin-top: 0.25rem;
    }
    photo-attachment {
      height: 4rem;
    }
    .upload-photo {
      min-height: 1.5rem;
      width: 1.5rem;
      padding: 0.25rem;
      justify-content: center;
    }
    .actions {
      text-align: right;
      margin-top: 0.5rem;
      padding-top: 0.5rem;
      border-top: 1px solid #eee;
    }
    .actions button {
      font-size: 0.875rem;
      padding: 0.5rem 1rem;
    }
    .actions button[type="submit"] {
      background: #1976d2;
      color: white;
      border-color: #1976d2;
    }
    .actions button[type="submit"]:hover:not(:disabled) {
      background: #1565c0;
    }
    .actions button[type="submit"]:disabled {
      background: var(--slate-300);
      border-color: var(--slate-300);
    }
    output {
      display: block;
      font-size: 0.8125rem;
      margin-bottom: 0.5rem;
    }
    output.error {
      color: #d32f2f;
    }
    output.success {
      color: #2e7d32;
    }
  `;

  @query('input[name=observed_time]', true)
  private timeInput: HTMLInputElement | undefined

  @query('input[name=observer_location]', true)
  private observerLocationInput: HTMLInputElement | undefined

  @query('input[name=subject_location]', true)
  private subjectLocationInput: HTMLInputElement | undefined

  private photosInputRef = createRef<HTMLInputElement>()

  #form = new TanStackFormController(this, {
    defaultValues: newSighting(),
    onSubmit: ({value}) => {
      const observedAt = Temporal.PlainDate.from(this.date).toZonedDateTime({timeZone: 'PST8PDT', plainTime: value.observed_time});
      const [observerX, observerY] = toLonLat(this.#observerFeature.getGeometry()!.getCoordinates())
      const [subjectX, subjectY] = toLonLat(this.#subjectFeature.getGeometry()!.getCoordinates());
      if (!subjectX || !subjectY)
        throw new Error("Subject coordinates not set");

      const photos = this.photos
        .filter(photo => photo.state === 'attached' || photo.state === 'uploaded')
        .map(photo => ({
          attribution: null,
          src: photo.url,
          license: value.photo_license,
          mimetype: null,
          thumb: photo.thumb,
        }));

      const payload: UpsertObservationArgs = {
        id: this.sightingId,
        body: value.body,
        count: isNaN(value.count) ? null : value.count,
        direction: value.travel_direction ? value.travel_direction : null,
        observed_at: observedAt.toInstant().toString(),
        observed_from: (observerX && observerY) ? {lon: observerX, lat: observerY} : null,
        photos,
        location: {lon: subjectX, lat: subjectY},
        accuracy: null,
        entity_id: value.entity_id,
        url: value.url,
      };
      this._saveTask.run([payload]);
      localStorage.setItem(ENTITY_CHOICE_STORAGE_KEY, value.entity_id);
    },
  })

  constructor() {
    super();
    this.addEventListener('remove-photo', e => {
      const photo = (e.target as PhotoAttachment).photo;
      this.removePhoto(photo);
    });
  }

  protected render() {
    const {canSubmit, isPristine, isValid} = this.#form.api.state;
    const enableSubmit = canSubmit && isValid && !isPristine
      && this.photos.filter(photo => photo.state === 'failed' || photo.state === 'uploading').length === 0;
    return html`
      <input ${ref(this.photosInputRef)} @change=${this.onFilesChanged} type="file" name="photos" accept="image/jpeg" multiple>
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
          if (!URL.canParse(value))
            return "Should start with https://";
        }}}, field => html`
          <label>
            <span class="label">Source URL</span>
            <div>
              <input type="url"
                     name="${field.name}"
                     placeholder="https://www.facebook.com/..."
                     .value=${field.state.value}
                     @change=${(e: Event) => field.handleChange((e.target as HTMLInputElement).value)}>
              ${field.state.meta.errors.map(err => html`<div class="field-error">${err}</div>`)}
            </div>
          </label>
        `)}
        ${this.#form.field({name: 'entity_id'}, field => html`
          <label>
            <span class="label">Species</span>
            <select name="${field.name}" @change=${(e: Event) => {
              const entityId = (e.target as HTMLSelectElement).value;
              field.handleChange(entityId);
              localStorage.setItem(ENTITY_CHOICE_STORAGE_KEY, entityId);
            }}>
              ${Object.entries(ENTITY_OPTIONS).map(([group, entityIds]) => html`
                <optgroup label=${group}>${entityIds.map(entityId => html`
                  <option value=${entityId} ?selected=${entityId === field.state.value}>${this.#optionLabel(entityId)}</option>
                `)}</optgroup>
              `)}
            </select>
          </label>
        `)}
        ${this.#form.field({ name: 'count', }, field => html` <label>
            <span class="label">Count</span>
            <input type="number" name="${field.name}" .value=${field.state.value} min="1" max="100" @change=${(e: Event) => field.handleChange((e.target as HTMLInputElement).valueAsNumber)}>
          </label>
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
          <label>
            <span class="label">Time</span>
            <div>
              <input type="time" name="${field.name}" step="1" required .value=${field.state.value} @change=${(e: InputEvent) => field.handleChange((e.target as HTMLInputElement).value)}>
              ${field.state.meta.errors.map(err => html`<div class="field-error">${err}</div>`)}
            </div>
          </label>
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
            <div>
              <div class="input-with-buttons">
                <input type="text" name="${field.name}" placeholder="lat, lon" .value=${field.state.value} @change=${(e: InputEvent) => {
                  const value = (e.target as HTMLInputElement).value;
                  field.handleChange(value);
                  this.onObserverInputChange(value);
                }}>
                <button @click=${this.placeObserver} title="Locate on map" type="button"><svg class="inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${clickTargetIcon}</svg></button>
                <button @click=${this.locateMe} ?disabled=${!('geolocation' in navigator)} title="My location" type="button"><svg class="inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${locateMeIcon}</svg></button>
              </div>
              ${field.state.meta.errors.map(err => html`<div class="field-error">${err}</div>`)}
            </div>
          </label>
        `)}
        ${this.#form.field({
          name: 'subject_location',
          validators: {onChange: ({value}) => {
            const latLon = value.trim();
            if (latLon.length > 0)
              return latLonInBoundsValidator(latLon);
          }},
        }, field => html`
          <label>
            <span class="label">Subject location</span>
            <div>
              <div class="input-with-buttons">
                <input type="text" name="${field.name}" placeholder="lat, lon" required .value=${field.state.value} @change=${(e: InputEvent) => {
                  const value = (e.target as HTMLInputElement).value;
                  field.handleChange(value)
                  this.onSubjectInputChange(value);
                }}>
                <button @click=${this.placeSubject} title="Locate on map" type="button"><svg class="inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${clickTargetIcon}</svg></button>
              </div>
              ${field.state.meta.errors.map(err => html`<div class="field-error">${err}</div>`)}
            </div>
          </label>
        `)}
        ${this.#form.field({name: 'travel_direction'}, field => html`
          <label>
            <span class="label">Travel direction</span>
            <select name="${field.name}" @change=${(e: Event) => field.handleChange((e.target as HTMLSelectElement).value as TravelDirection)}>
              ${repeat(Object.entries(DIRECTION_OPTIONS), ([key]) => key, ([key, label]) => html`
                <option value=${key} ?selected=${key === field.state.value}>${label}</option>
              `)}
            </select>
          </label>
        `)}
        ${this.#form.field({name: 'body'}, field => html`
          <label>
            <span class="label">Notes</span>
            <textarea name="${field.name}" rows="3" .value=${field.state.value} @change=${(e: Event) => field.handleChange((e.target as HTMLTextAreaElement).value)}></textarea>
          </label>
        `)}
        <label>
          <span>Photos</span>
          <div class="thumbnails">
            ${repeat(this.photos.filter(photo => photo.state !== 'removed'), photo => photo.id, photo => html`
              <photo-attachment class=${photo.state} .photo=${photo}>
              </photo-attachment>
            `)}
            <button @click=${this.onUploadClicked} class="upload-photo" type="button" title="Add photo">
              <svg class="inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${cameraAddIcon}</svg>
            </button>
          </div>
        </label>
        ${this.#form.field({name: 'photo_license'}, field => html`
          <label>
            <span class="label">Photo license</span>
            <select name="${field.name}" ?required=${this.photos.filter(photo => photo.state !== 'removed').length > 0} @change=${(e: Event) => {
              const licenseCode = (e.target as HTMLSelectElement).value;
              field.handleChange(licenseCode as License);
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
              <button type="submit" ?disabled=${!enableSubmit}>Save</button>
            `,
            pending: () => html`
              <output>Saving…</output>
              <button type="button" @click=${this.cancel}>Cancel</button>
              <button type="submit" disabled>Save</button>
            `,
            complete: () => html`
              <output class="success">Sighting created.</output>
              <button type="button" @click=${this.cancel}>Cancel</button>
              <button type="submit" ?disabled=${!enableSubmit}>Save</button>
            `,
            error: (error: unknown) => html`
              <output class="error">${error}</output>
              <button type="button" @click=${this.cancel}>Cancel</button>
              <button type="submit" ?disabled=${!enableSubmit}>Save</button>
            `
          })}
        </div>
      </form>
    `;
  }

  removePhoto(photo: Photo) {
    // By id, and guarded. `indexOf` on the object reference the rendered
    // <photo-attachment> is holding returns -1 as soon as the list has been
    // rebuilt underneath it, and `toSpliced(-1, 1, …)` does not fail — it
    // replaces the LAST element. So a stale reference used to delete a photo
    // the person never touched while leaving the one they clicked in place
    // (bd salish-jo5). A removal we cannot place is a no-op.
    const index = this.photos.findIndex(candidate => candidate.id === photo.id);
    if (index === -1)
      return;
    this.photos = this.photos.toSpliced(index, 1, {...this.photos[index]!, state: 'removed'});
  }

  private locateMe() {
    const geo = navigator.geolocation;
    geo.getCurrentPosition(({coords: {latitude, longitude}}) => {
      this.#observerFeature.getGeometry()!.setCoordinates(fromLonLat([longitude, latitude]));
    }, error => {
      // The button offers to place the observer marker for you; when it can't,
      // the marker simply stays put, which is indistinguishable from a slow
      // fix. Say which of the two it is, and why.
      reportError(this, geolocationMessage(error, 'place your marker'), {
        cause: error,
        capture: geolocationErrorIsReportable(error),
      });
    }, {
      maximumAge: 1000 * 10,
      timeout: 1000 * 5,
      enableHighAccuracy: false,
    });
  }

  private onDragOver(e: DragEvent) {
    e.preventDefault();
  }

  private async onDrop(e: DragEvent) {
    const transfer = e.dataTransfer;
    if (!transfer?.files.length)
      return;
    e.preventDefault();

    await this.appendPhotos([...transfer.files]);
  }

  private async onFilesChanged() {
    const files = this.photosInputRef.value?.files;
    if (!files)
      return;
    await this.appendPhotos([...files])
    this.photosInputRef.value!.value = '';
  }

  /**
   * Settle the photo carrying `id` into `next` — the one way an upload reports
   * back.
   *
   * By id, and against `this.photos` as it is *now*, because everything else
   * has moved on by the time an upload lands: the person may have added more
   * photos, removed this one, or left. Returns whether it applied, so a caller
   * can stay quiet about a photo nobody is waiting for any more.
   */
  #settlePhoto(id: string, next: Photo): boolean {
    const index = this.photos.findIndex(photo => photo.id === id);
    // Gone entirely (the form was reloaded from an observation), or the person
    // removed it while the upload was in flight and does not want it back.
    if (index === -1 || this.photos[index]!.state === 'removed')
      return false;
    this.photos = this.photos.toSpliced(index, 1, next);
    return true;
  }

  /**
   * Public alongside {@link removePhoto} — the two halves of one job, and the
   * pair a test needs to drive the timing that broke this (bd salish-8q9).
   */
  async appendPhotos(files: File[]) {
    for (const file of files) {
      const id = newPhotoId();
      const thumb = await photoThumbnail(file);

      // Publish the photo BEFORE its upload starts, and one at a time rather
      // than batching the whole selection at the end. This is the fix for bd
      // salish-8q9: the previous version filled a local copy of the array and
      // assigned it after the loop, while holding an index into it that the
      // upload callbacks used against `this.photos`. Reading EXIF off a phone
      // photo is slow enough that an early upload routinely landed while a
      // later file was still being read, when the two arrays were still
      // different lengths — so the callback wrote past the end of `this.photos`
      // (which appends rather than replaces), and the assignment after the loop
      // then threw that result away. The photo stayed 'uploading' forever, and
      // `enableSubmit` refuses to enable Save while anything is, so the whole
      // sighting became unsaveable with nothing on screen to explain why.
      this.photos = [...this.photos, {id, state: 'uploading', file, thumb}];

      const {coordinates, date, time} = await readExif(file);

      // Publishing the photo before its upload (above) also makes it removable
      // during this read, which the previous arrangement did not — so check
      // before acting on it. Everything below is something the person has just
      // said they do not want: EXIF from a discarded photo would move their
      // observer marker and change the sighting's time, and the upload would
      // spend a phone's data on a file destined for nothing. #settlePhoto
      // guards the landing, but by then both have already happened.
      if (this.photos.find(photo => photo.id === id)?.state !== 'uploading')
        continue;

      if (coordinates)
        this.receiveCoordinatesFromUpload(coordinates);
      if (date)
        this.receiveDateFromUpload(date);
      if (time)
        this.receiveTimeFromUpload(time);

      uploadPhoto(file, this.sightingId).then(url => {
        const uploaded: UploadedPhoto = {id, state: 'uploaded', thumb, url};
        this.#settlePhoto(id, uploaded);
      }).catch((error: unknown) => {
        const errored: FailedUploadPhoto = {id, state: 'failed', file, thumb, error};
        // Say so, to both audiences (decision 031). The failed thumbnail alone
        // left the person to guess what a red border meant and left us with
        // nothing at all — bd salish-16b, which is why we cannot say what went
        // wrong for the report that prompted this.
        if (this.#settlePhoto(id, errored))
          reportError(this, `Couldn't upload ${file.name || 'that photo'}. Remove it and try again.`, {cause: error});
      });
    }
  }

  private receiveDateFromUpload(date: string) {
    if (date !== this.date) {
      const dateSelected = new CustomEvent('date-selected', {bubbles: true, composed: true, detail: date});
      this.dispatchEvent(dateSelected);
    }
  }

  private receiveTimeFromUpload(time: string) {
    if (this.timeInput!.value === '') {
      this.timeInput!.value = time;
      this.timeInput!.dispatchEvent(new Event('change'));
    }
  }

  private receiveCoordinatesFromUpload(coords: Coordinate) {
    if (this.#observerFeature.getGeometry()!.getCoordinates().length === 0)
      this.#observerFeature.getGeometry()!.setCoordinates(coords);
  }

  private onUploadClicked() {
    this.photosInputRef.value!.click();
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
      if (typedField === 'photos') {
        this.photos = value as SightingFormData[typeof typedField];
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
      // symbology groups and labels by scientific name, so the draft needs the one the
      // saved sighting will read as ('Orcinus orca rectipinnus' for Bigg's -> "Biggs").
      taxon: {
        scientific_name: this._namesTask.value?.get(values.entity_id)?.inaturalist_scientific_name ?? null,
        vernacular_name: null,
        entity_id: values.entity_id,
      },
    });
  }

  /** The register's name for an option, or its identifier until names arrive (or if it has none). */
  #optionLabel(entityId: string): string {
    const names = this._namesTask.value?.get(entityId);
    return names?.common_name ?? names?.taxon_common_name ?? entityId;
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
