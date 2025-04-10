import {parse, stringify} from 'uuid';
import { db } from './database.ts';
import type { SightingForm } from '../types.ts';

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
const upsertSightingStatement = db.prepare<SightingRow>(`
INSERT OR REPLACE INTO sightings
( id,  observed_at,  longitude,  latitude,  observer_longitude,  observer_latitude,  taxon_id,  body,  count,  individuals,  url)
VALUES
(@id, @observed_at, @longitude, @latitude, @observer_longitude, @observer_latitude, @taxon_id, @body, @count, @individuals, @url)
`);
export function upsertSighting(sighting: SightingForm) {
  const [longitude, latitude] = sighting.subject_location;
  const [observer_longitude, observer_latitude] = sighting.observer_location;
  const row = {
    ...sighting,
    id: stringify(parse(sighting.id)),
    individuals: sighting.individuals.join(','),
    latitude,
    longitude,
    observer_latitude,
    observer_longitude,
  };
  upsertSightingStatement.run(row);
}
