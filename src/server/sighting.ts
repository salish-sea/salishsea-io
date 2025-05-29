import {parse, stringify} from 'uuid';
import { db } from './database.ts';
import type { SightingForm } from '../types.ts';
import { taxonByName } from './taxon.ts';
import { bucket, region } from './storage.ts';

const S3_BASE_URI = `https://${bucket}.s3.${region}.amazonaws.com`;

type SightingRow = {
  id: string; // uuid
  observed_at: number; // unix epoch time
  longitude: number;
  latitude: number;
  observer_longitude: number;
  observer_latitude: number;
  taxon_id: number;
  body: string | null;
  count: number | null;
  individuals: string;
  url: string | null;
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
( id,  user,  observed_at,  longitude,  latitude,  observer_longitude,  observer_latitude,  taxon_id,  body,  count,  individuals,  url)
VALUES
(@id, @user, @observed_at, @longitude, @latitude, @observer_longitude, @observer_latitude, @taxon_id, @body, @count, @individuals, @url)
`);
const insertPhotoStatement = db.prepare<Omit<PhotoRow, 'id'>>(`
INSERT INTO sighting_photos
( sighting_id,  idx,  href,  license_code)
VALUES
(@sighting_id, @idx, @href, @license_code)
`);
const insertSightingTxn = db.transaction((sighting: SightingRow, photos: Omit<PhotoRow, 'id'>[]) => {
  insertSightingStatement.run(sighting);
  for (const photo of photos)
    insertPhotoStatement.run(photo);
});
export function upsertSighting(form: SightingForm) {
  const [longitude, latitude] = form.subject_location;
  const [observer_longitude, observer_latitude] = form.observer_location;
  const taxon = taxonByName(form.taxon);
  if (!taxon)
    throw `Couldn't find a taxon named ${form.taxon}`;
  const body = form.body?.trim().length ? form.body.trim() : null;
  const sighting = {
    body,
    count: form.count || null,
    id: stringify(parse(form.id)),
    individuals: '',
    latitude,
    longitude,
    observed_at: form.observed_at,
    observer_latitude,
    observer_longitude,
    taxon_id: taxon.id,
    url: form.url || null,
  };
  const photos = form.photo.map((photo, idx) => ({
    sighting_id: sighting.id,
    href: `https://${S3_BASE_URI}/${photo}`,
    idx,
    license_code: form.license_code,
  }));
  insertSightingTxn(sighting, photos);
}
