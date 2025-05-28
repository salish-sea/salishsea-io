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
  body: string | null;
  count: number | null;
  observed_at: number; // unix epoch time
  observer_location: [number, number]; // lon, lat
  photo: string[];
  subject_location: [number, number]; // lon, lat
  taxon: string;
  url: string | null;
}
