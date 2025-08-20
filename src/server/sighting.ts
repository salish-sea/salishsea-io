import {parse, stringify} from 'uuid';
import { db } from './database.ts';
import { taxonByName } from './taxon.ts';
import { bucket, region } from './storage.ts';
import type { SightingPayload } from '../api.ts';

const S3_BASE_URI = `https://${bucket}.s3.${region}.amazonaws.com`;
const MIN_SIGHTING_DATE = new Date(Date.parse('1985-06-13'));

type SightingRow = {
  id: string; // uuid
  created_at: number; // unix epoch time in milliseconds
  updated_at: number; // unix epoch time in milliseconds
  user: string;
  observed_at: number; // unix epoch time in seconds
  longitude: number;
  latitude: number;
  observer_longitude: number | null;
  observer_latitude: number | null;
  taxon_id: number;
  body: string | null;
  count: number | null;
  individuals: string;
  url: string | null;
  direction: string | null;
}
type PhotoRow = {
  id: number;
  sighting_id: string;
  idx: number;
  href: string;
  license_code: string;
}
const insertSightingStatement = db.prepare<SightingRow>(`
INSERT INTO sightings
( id,  created_at,  updated_at,  user,  observed_at,  longitude,  latitude,  observer_longitude,  observer_latitude,  taxon_id,  body,  count,  individuals,  url,  direction)
VALUES
(@id, @created_at, @updated_at, @user, @observed_at, @longitude, @latitude, @observer_longitude, @observer_latitude, @taxon_id, @body, @count, @individuals, @url, @direction)
ON CONFLICT (id) DO UPDATE SET
updated_at=@updated_at, observed_at=@observed_at, longitude=@longitude, latitude=@latitude, observer_longitude=@observer_longitude,
taxon_id=@taxon_id, body=@body, count=@count, individuals=@individuals, url=@url
WHERE sightings.user=@user
`);
const clearPhotosStatement = db.prepare<string>(`DELETE FROM sighting_photos WHERE sighting_id=?`);
const insertPhotoStatement = db.prepare<Omit<PhotoRow, 'id'>>(`
INSERT INTO sighting_photos
( sighting_id,  idx,  href,  license_code)
VALUES
(@sighting_id, @idx, @href, @license_code)
`);
const insertSightingTxn = db.transaction((sighting: SightingRow, photos: Omit<PhotoRow, 'id'>[]) => {
  insertSightingStatement.run(sighting);
  clearPhotosStatement.run(sighting.id);
  for (const photo of photos)
    insertPhotoStatement.run(photo);
});
export function upsertSighting(id: string, form: SightingPayload, timestamp: Date, user: string) {
  const [longitude, latitude] = form.subject_location;
  const [observer_longitude, observer_latitude] = form.observer_location || [null, null];

  const taxon = taxonByName(form.taxon);
  if (!taxon)
    throw new Error(`Couldn't find a taxon named ${form.taxon}`);

  const observedAt = new Date(form.observed_at);
  if (observedAt < MIN_SIGHTING_DATE)
    throw new Error(`Sighting observed before ${MIN_SIGHTING_DATE.toLocaleDateString()}`);
  if (observedAt > timestamp)
    throw new Error(`Sighting observed in the future`);

  const body = form.body?.trim().length ? form.body.trim() : null;
  const sighting = {
    body,
    count: form.count || null,
    created_at: timestamp.valueOf(),
    direction: form.direction || null,
    id: stringify(parse(id)),
    individuals: '',
    latitude,
    longitude,
    observed_at: observedAt.valueOf() / 1000,
    observer_latitude,
    observer_longitude,
    taxon_id: taxon.id,
    updated_at: timestamp.valueOf(),
    url: form.url || null,
    user,
  };
  const photos = form.photos.map((photo, idx) => ({
    sighting_id: sighting.id,
    href: new URL(photo, S3_BASE_URI + '/').toString(),
    idx,
    license_code: form.photo_license,
  }));
  return insertSightingTxn(sighting, photos);
}

const deleteSightingStatement = db.prepare<{id: string, user: string}>(`
DELETE FROM sightings WHERE id=@id AND user=@user
`);
export function deleteSighting(id: string, user: string) {
  const result = deleteSightingStatement.run({id, user});
  return result.changes > 0;
}
