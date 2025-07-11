import type { Feature, FeatureCollection, Geometry, Point } from 'geojson';
import type {FerryLocationProperties} from './server/ferries.ts'
import type { SightingProperties } from './server/temporal-features.ts';
export type { SightingProperties } from './server/temporal-features.ts';
export type {FerryLocationProperties} from './server/ferries.ts';
import type { TravelLineProperties } from './server/travel.ts';
export type { SightingPhoto } from './server/temporal-features.ts';

export type FeatureProperties = FerryLocationProperties | SightingProperties | TravelLineProperties;

// [minx, miny, maxx, maxy]
export type Extent = [number, number, number, number];

export type SightingForm = {
  id: string; // uuid
  body?: string | null;
  count?: number | null;
  direction: string | null;
  license_code: string;
  observed_at: number; // unix epoch time
  observer_location: null | [number, number]; // lon, lat
  photo: string[];
  subject_location: [number, number]; // lon, lat
  taxon: string;
  url?: string | null;
}

export type UpsertSightingResponse = {
  id: string;
}

export type TemporalFeaturesResponse = FeatureCollection<Geometry, FeatureProperties> & {
  params: {date: string};
}

export function isSighting(feature: Feature): feature is Feature<Point, SightingProperties> {
  return feature.properties?.kind === 'Sighting';
}
