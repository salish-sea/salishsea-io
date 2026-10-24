/**
 * What the sighting form holds and what it sends (salish-h2n): its values, the values for
 * a sighting being edited or cloned, the checks on what a person types, and the request
 * the write API is sent on save. Pure apart from this browser's remembered choices, so
 * the form element (sighting-form.ts) keeps only rendering, the map's points and photos,
 * and what is sent can be tested without one. The accuracy that went missing between the
 * form and the API (#742) went missing here.
 */

import { Temporal } from "temporal-polyfill";
import { convert as parseCoords } from 'geo-coordinates-parser';
import { acartiaExtent } from './constants.ts';
import { MAX_ACCURACY_M, type LonLat } from "./sighting-drafts.ts";
import { newPhotoId, type Photo } from "./photo-attachment.ts";
import type { License, Occurrence, TravelDirection, UpsertObservationArgs } from "./types.ts";

/**
 * What the form offers, by register entity (salish-53t.3). The labels come from the register
 * at runtime (public.animal_names), so nothing here names an animal: decision 033 keys on
 * `SSA:`, never on a name, and a list of our own labels drifts from the register the first
 * time it renames something. The group headings are ours — a way of laying out a menu, not
 * a claim about taxonomy ("Whales" holds a sperm whale beside the baleen whales).
 *
 * A group starts with the broadest thing an observer can say about it, where the register
 * holds one and the map can draw it, so someone who saw "a baleen whale" can say only that
 * (decision 089, #761). Pinnipeds are left out: the register's crosswalk takes Pinnipedia to
 * iNaturalist's Phocoidea, which the map draws as an unknown animal. Northern Residents wait
 * for the register to hold them (salish-sea/animals#4).
 *
 * Harbour seal, Steller sea lion and sea otter were iNaturalist subspecies here until the
 * register became the dictionary; it holds the species, so that is what a sighting records.
 */
export const ENTITY_OPTIONS: Readonly<Record<string, readonly string[]>> = {
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
    "SSA:0000010", // Southern Resident, a community of the Resident ecotype
  ],
  "Whales": [
    "SSA:0000935", // Mysticeti, species unknown
    "SSA:0000901", // Megaptera novaeangliae
    "SSA:0000905", // Eschrichtius robustus
    "SSA:0000915", // Balaenoptera acutorostrata
    "SSA:0000916", // Balaenoptera physalus
    "SSA:0000921", // Physeter macrocephalus
  ],
  "Otters": [
    "SSA:0000939", // Lutrinae, species unknown
    "SSA:0000906", // Lontra canadensis
    "SSA:0000918", // Enhydra lutris
  ],
};
export const OFFERED_ENTITIES = new Set(Object.values(ENTITY_OPTIONS).flat());
const DEFAULT_ENTITY = "SSA:0000900";

const PHOTO_LICENSE_CHOICE_STORAGE_KEY = 'photoLicenseCode';
// A new key, not 'lastTaxon': that one holds a scientific name from before salish-53t.3.
const ENTITY_CHOICE_STORAGE_KEY = 'lastEntity';
/** The last species this browser reported, if it is still one the form offers. */
function lastEntityChoice(): string {
  const stored = localStorage.getItem(ENTITY_CHOICE_STORAGE_KEY);
  return stored && OFFERED_ENTITIES.has(stored) ? stored : DEFAULT_ENTITY;
}

/** Remember the species this browser last reported, so the next report starts there. */
export function rememberEntityChoice(entityId: string): void {
  localStorage.setItem(ENTITY_CHOICE_STORAGE_KEY, entityId);
}

/** Remember the licence this browser last chose for its photos. */
export function rememberPhotoLicense(license: License): void {
  localStorage.setItem(PHOTO_LICENSE_CHOICE_STORAGE_KEY, license);
}

export type SightingFormData = {
  body: string;
  count: number;
  observed_time: string;
  observer_location: string;
  photo_license: License;
  photos: Photo[];
  subject_location: string;
  /** How far the animal may have been from the subject location, in metres (decision 077); empty when not stated. */
  accuracy: string;
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
    accuracy: '',
    entity_id: lastEntityChoice(),
    travel_direction: '',
    url: '',
  };
}
export function observationToFormData(observation: Occurrence): SightingFormData & {id: string} {
  const observedAt = Temporal.Instant.from(observation.observed_at).toZonedDateTimeISO('America/Los_Angeles').toPlainDateTime();
  return {
    body: observation.body || '',
    count: observation.count || NaN,
    id: observation.id,
    observed_time: observedAt.toPlainTime().toString(),
    observer_location: observation.observed_from ? `${observation.observed_from.lat.toFixed(4)}, ${observation.observed_from.lon.toFixed(4)}` : '',
    photo_license: observation.photos[0]?.license || getPhotoLicense(),
    photos: observation.photos.map(photo => ({id: newPhotoId(), state: 'attached' as const, thumb: photo.thumb || photo.src, url: photo.src})),
    subject_location: `${observation.location.lat.toFixed(4)}, ${observation.location.lon.toFixed(4)}`,
    // Only our own sightings' accuracy is how far off the animal was; another source's
    // describes something else (decision 077), so a copy of one starts without it.
    accuracy: observation.provider_slug === 'direct' && observation.accuracy ? String(observation.accuracy) : '',
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

/** What the form knows besides its fields: which sighting, which day, its points, and its photos. */
export type SightingContext = {
  id: string;
  /** The day being shown, 'YYYY-MM-DD'; the time field is a time on it, in Pacific time. */
  date: string;
  observer: LonLat | null;
  subject: LonLat | null;
  photos: readonly Photo[];
};

/**
 * The request the write API is sent when the form is saved. Throws when the subject has
 * no point, which the form's own checks stop before it gets here.
 */
export function sightingPayload(value: SightingFormData, {id, date, observer, subject, photos}: SightingContext): UpsertObservationArgs {
  if (!subject)
    throw new Error("Subject coordinates not set");
  const observedAt = Temporal.PlainDate.from(date).toZonedDateTime({timeZone: 'America/Los_Angeles', plainTime: value.observed_time});
  return {
    id,
    body: value.body,
    count: isNaN(value.count) ? null : value.count,
    direction: value.travel_direction ? value.travel_direction : null,
    observed_at: observedAt.toInstant().toString(),
    observed_from: observer ? {lon: observer[0], lat: observer[1]} : null,
    // A photo still uploading, or whose upload failed or was removed, isn't sent.
    photos: photos
      .filter(photo => photo.state === 'attached' || photo.state === 'uploaded')
      .map(photo => ({
        attribution: null,
        src: photo.url,
        license: value.photo_license,
        mimetype: null,
        thumb: photo.thumb,
      })),
    location: {lon: subject[0], lat: subject[1]},
    accuracy: parseAccuracy(value.accuracy),
    entity_id: value.entity_id,
    url: value.url,
  };
}

/** The accuracy field's complaint, if any: a whole number of metres, or empty. */
export function accuracyValidator(value: string): string | undefined {
  const text = value.trim();
  if (text === '')
    return;
  const metres = Number(text);
  if (!Number.isInteger(metres) || metres < 1 || metres > MAX_ACCURACY_M)
    return `A whole number of metres, from 1 to ${MAX_ACCURACY_M.toLocaleString('en-US')}`;
}

/** The metres the accuracy field holds, or null when it holds none. */
export function parseAccuracy(value: string): number | null {
  const metres = Number(value.trim());
  return value.trim() !== '' && Number.isInteger(metres) && metres >= 1 && metres <= MAX_ACCURACY_M ? metres : null;
}

/** The longitude and latitude a location input holds, or null when it holds none. */
export function parseLonLat(value: string): LonLat | null {
  if (value.trim() === '')
    return null;
  try {
    const {decimalLatitude, decimalLongitude} = parseCoords(value, 4);
    return [decimalLongitude, decimalLatitude];
  } catch {
    return null;
  }
}
