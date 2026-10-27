import { css, html, LitElement, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { consume } from "@lit/context";
import { licenseCodes } from './constants.ts';
import { Temporal } from "temporal-polyfill";
import { distanceLabel, MAX_ACCURACY_M, SUGGESTED_FRACTION, SUGGESTED_MIN_M, sightingDraftsContext, type DraftPoints, type LonLat, type SightingDraft, type SightingDrafts } from "./sighting-drafts.ts";
import { repeat } from "lit/directives/repeat.js";
import { classMap } from "lit/directives/class-map.js";
import { distance as getDistance } from "@turf/distance";
import {createRef, ref} from 'lit/directives/ref.js';
import { cameraAddIcon, clickTargetIcon, locateMeIcon } from "./icons.ts";
import {Task} from '@lit/task';
import './photo-attachment.ts';
import { TanStackFormController } from '@tanstack/lit-form';
import { detectIndividuals } from "./identifiers.ts";
import { type License, type TravelDirection, type UpsertObservationArgs } from "./types.ts";
import { fetchStaticAnimalNames } from "./read-path.ts";
import { saveSighting } from "./write-api.ts";
import { reportError } from "./report-error.ts";
import { geolocationErrorIsReportable, geolocationMessage } from "./geolocation-message.ts";
import {
  accuracyValidator, ENTITY_OPTIONS, latLonInBoundsValidator, newSighting, OFFERED_ENTITIES, parseAccuracy, parseLonLat,
  rememberEntityChoice, rememberPhotoLicense, sightingPayload, type SightingFormData,
} from './sighting-form-data.ts';
import PhotoAttachment, { newPhotoId, photoThumbnail, readExif, uploadPhoto, type FailedUploadPhoto, type Photo, type UploadedPhoto } from "./photo-attachment.ts";




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


@customElement('sighting-form')
export default class SightingForm extends LitElement {
  private _saveTask = new Task(this, {
    autoRun: false,
    task: async([occurrence]: [UpsertObservationArgs]) => {
      await saveSighting(occurrence);
      this.dispatchEvent(new CustomEvent('sighting-saved', {bubbles: true, composed: true, detail: occurrence}));
      return null;
    }
  });

  /** The register's names for what the form offers; the menu shows ids until they arrive. */
  private _namesTask = new Task(this, {
    task: () => fetchStaticAnimalNames([...OFFERED_ENTITIES]),
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

  /** True for a sighting not yet saved, a blank one or a copy of another; false while editing a saved one. */
  @property({attribute: false, type: Boolean})
  isNew = true

  // Subscribed, so the form doesn't depend on <obs-map> having handed over its
  // drafts before the form first renders.
  @consume({context: sightingDraftsContext, subscribe: true})
  @state()
  private drafts: SightingDrafts | undefined

  /** This sighting's observer and subject on the map. */
  #draft: SightingDraft | undefined

  /**
   * True while the accuracy field holds our suggestion rather than the author's value:
   * from the start for a new sighting, until the author sets or clears it (decision 077).
   * Kept here as well as on the draft, so a draft made again keeps suggesting.
   */
  #suggesting = false

  /** The distance from observer to subject, in metres, while the field holds a suggestion made from it. */
  @state()
  private suggestedFrom: number | null = null

  static styles = css`
    :host {
      display: block;
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
      font-family: inherit;
      font-size: var(--fs-caption);
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
      font-weight: 400;
      font-size: var(--fs-body2);
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
      font-size: var(--fs-body2);
    }
    input[type="number"] {
      width: 5em;
    }
    /* Values a machine reads, as on a sighting's card. */
    input[type="time"],
    input[name$="_location"] {
      font-family: var(--font-mono);
      font-size: var(--fs-mono);
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
    .input-with-buttons .unit {
      color: var(--slate-500, #64748b);
      flex-shrink: 0;
      font-size: var(--fs-body2);
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
    input.suggested {
      color: var(--slate-500, #64748b);
      font-style: italic;
    }
    .field-hint {
      color: var(--slate-500, #64748b);
      font-size: var(--fs-caption);
      margin-top: 0.25rem;
    }
    .field-error {
      color: #d32f2f;
      font-size: var(--fs-caption);
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
      font-size: var(--fs-body2);
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
      font-size: var(--fs-body2);
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

  @query('input[name=accuracy]', true)
  private accuracyInput: HTMLInputElement | undefined

  private photosInputRef = createRef<HTMLInputElement>()

  #form = new TanStackFormController(this, {
    defaultValues: newSighting(),
    onSubmit: ({value}) => {
      const payload = sightingPayload(value, {
        id: this.sightingId, date: this.date, photos: this.photos,
        observer: this.#draft?.observer ?? null, subject: this.#draft?.subject ?? null,
      });
      this._saveTask.run([payload]);
      rememberEntityChoice(value.entity_id);
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
            <span class="label">Animal</span>
            <select name="${field.name}" @change=${(e: Event) => {
              const entityId = (e.target as HTMLSelectElement).value;
              field.handleChange(entityId);
              rememberEntityChoice(entityId);
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
                .toZonedDateTime({timeZone: 'America/Los_Angeles', plainTime: str});
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
        ${this.#form.field({
          name: 'accuracy',
          validators: {onChange: ({value}) => accuracyValidator(value)},
        }, field => html`
          <label title="How far the animal may have been from the subject location. You can also drag the handle beside the subject on the map.">
            <span class="label">Give or take</span>
            <div>
              <div class="input-with-buttons">
                <input type="number" name="${field.name}" class=${classMap({suggested: this.suggestedFrom !== null})} min="1" max=${MAX_ACCURACY_M} step="1" inputmode="numeric" placeholder="metres, if you know"
                  .value=${field.state.value} @change=${(e: InputEvent) => {
                  const value = (e.target as HTMLInputElement).value;
                  field.handleChange(value);
                  this.onAccuracyInputChange(value);
                }}>
                <span class="unit">m</span>
              </div>
              ${this.suggestedFrom !== null && field.state.value !== '' ? html`<div class="field-hint">${suggestionHint(this.suggestedFrom)}</div>` : ''}
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
              const licenseCode = (e.target as HTMLSelectElement).value as License;
              field.handleChange(licenseCode);
              rememberPhotoLicense(licenseCode);
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
    const found = this.photos[index];
    if (!found)
      return;
    this.photos = this.photos.toSpliced(index, 1, {...found, state: 'removed'});
  }

  private locateMe() {
    const geo = navigator.geolocation;
    geo.getCurrentPosition(({coords: {latitude, longitude}}) => {
      this.#draft?.set('observer', [longitude, latitude]);
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
    const input = this.photosInputRef.value;
    if (!input?.files)
      return;
    await this.appendPhotos([...input.files])
    input.value = '';
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
    if (index === -1 || this.photos[index]?.state === 'removed')
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
    const input = this.timeInput;
    if (input && input.value === '') {
      input.value = time;
      input.dispatchEvent(new Event('change'));
    }
  }

  private receiveCoordinatesFromUpload(lonLat: LonLat) {
    if (this.#draft && !this.#draft.observer)
      this.#draft.set('observer', lonLat);
  }

  private onUploadClicked() {
    this.photosInputRef.value?.click();
  }

  private placeObserver() {
    this.#draft?.place('observer');
  }

  private placeSubject() {
    this.#draft?.place('subject');
  }

  private onObserverInputChange(value: string) {
    this.#draft?.set('observer', parseLonLat(value));
  }

  private onSubjectInputChange(value: string) {
    this.#draft?.set('subject', parseLonLat(value));
  }

  private onAccuracyInputChange(value: string) {
    if (accuracyValidator(value) === undefined)
      this.#draft?.setAccuracy(parseAccuracy(value));
    else
      // Text the author is still correcting is theirs too: the suggestion stops following the points.
      this.#draft?.keepAccuracy();
  }

  /** The radius the accuracy field last heard from the map. */
  #syncedAccuracy: number | null | undefined = undefined;

  /** A point or the ring changed, on the map or in an input: make the inputs say where they are. */
  private onPointsChanged({observer, subject}: DraftPoints) {
    if (!this.observerLocationInput || !this.subjectLocationInput || !this.accuracyInput)
      return;
    const write = (input: HTMLInputElement, text: string) => {
      if (input.value !== text) {
        input.value = text;
        input.dispatchEvent(new Event('change'));
      }
    };
    write(this.observerLocationInput, observer ? `${observer[1].toFixed(4)}, ${observer[0].toFixed(4)}` : '');
    write(this.subjectLocationInput, subject ? `${subject[1].toFixed(4)}, ${subject[0].toFixed(4)}` : '');
    // Writing a point's input moves the point again, to where four decimals put it, and
    // with it a suggested radius; so the radius is read from the draft only now, after
    // that, and not from what this call was told.
    const draft = this.#draft;
    if (!draft)
      return;
    const {accuracy, suggested} = draft;
    this.#suggesting = suggested;
    this.suggestedFrom = suggested && draft.observer && draft.subject ? getDistance(draft.observer, draft.subject) * 1000 : null;
    // Only when the radius itself changed: moving a point mustn't overwrite text the
    // author is still correcting, such as an invalid 0, with the radius before it.
    if (accuracy !== this.#syncedAccuracy) {
      this.#syncedAccuracy = accuracy;
      write(this.accuracyInput, accuracy ? String(accuracy) : '');
    }
  }

  protected firstUpdated(_changedProperties: PropertyValues): void {
    // A new sighting without an accuracy of its own starts with a suggested one; one
    // being edited keeps what was saved, including nothing.
    this.#suggesting = this.isNew && !this.initialValues.accuracy;
    for (const [field, value] of Object.entries(this.initialValues)) {
      const typedField = field as keyof typeof this.initialValues;
      if (typedField === 'photos') {
        this.photos = value as SightingFormData[typeof typedField];
      } else {
        const typedValue = value as SightingFormData[typeof typedField];
        this.#form.api.setFieldValue(typedField, typedValue);
      }
    }
    this.#startDraft();
    this.#form.api.baseStore.subscribe(this.updateSubjectProps.bind(this));
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has('drafts'))
      this.#startDraft();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.hasUpdated)
      this.#startDraft();
  }

  /** Put this sighting on the map, where its inputs say, once there is a map to put it on. */
  #startDraft() {
    if (this.#draft || !this.drafts || !this.hasUpdated)
      return;
    const values = this.#form.api.baseStore.state.values;
    this.#draft = this.drafts.create(this.sightingId, this.onPointsChanged.bind(this), {
      observer: parseLonLat(values.observer_location),
      subject: parseLonLat(values.subject_location),
      accuracy: parseAccuracy(values.accuracy),
      suggested: this.#suggesting,
    });
    // A copy can arrive with both points, and so with a suggestion the field hasn't heard of.
    this.onPointsChanged(this.#draft);
    this.updateSubjectProps();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#draft?.remove();
    this.#draft = undefined;
  }

  updateSubjectProps() {
    const values = this.#form.api.baseStore.state.values;
    this.#draft?.setSubjectOccurrence({
      direction: values.travel_direction,
      identifiers: detectIndividuals(values.body),
      // symbology groups and labels by scientific name, so the draft needs the one the
      // saved sighting will read as ('Orcinus orca rectipinnus' for Bigg's -> "Biggs").
      taxon: {
        scientific_name: this._namesTask.value?.get(values.entity_id)?.inaturalist_scientific_name ?? null,
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

/** The line under a suggested accuracy, saying how it was worked out from the distance between the points. */
function suggestionHint(distance: number): string {
  return distance * SUGGESTED_FRACTION < SUGGESTED_MIN_M
    ? `Suggested: ${SUGGESTED_MIN_M} m, the least we suggest, as the subject is only ${distanceLabel(distance)} from the observer. Change it if you can judge better.`
    : `Suggested: a quarter of the ${distanceLabel(distance)} from observer to subject. Change it if you can judge better.`;
}

