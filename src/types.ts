import type {FerryLocationProperties} from './server/ferries.ts'
import type { SightingProperties } from './server/temporal-features.ts';
export type { SightingProperties } from './server/temporal-features.ts';
export type {FerryLocationProperties} from './server/ferries.ts';
import type { TravelLineProperties } from './server/travel.ts';
export type { SightingPhoto } from './server/temporal-features.ts';

export type FeatureProperties = FerryLocationProperties | SightingProperties | TravelLineProperties;

export type Extent = [number, number, number, number];

export type SightingForm = {
  id: string; // uuid
  observed_at: number; // unix epoch time
  subject_location: [number, number]; // lon, lat
  observer_location: [number, number]; // lon, lat
  taxon: string;
  body: string | null;
  count: number | null;
  url: string | null;
}
