import type { Timestamp } from './server/database.ts';
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
  body?: string | null;
  count?: number | null;
  license_code: string;
  observed_at: number; // unix epoch time
  observer_location: null | [number, number]; // lon, lat
  photo: string[];
  subject_location: [number, number]; // lon, lat
  taxon: string;
  url?: string | null;
}

export const licenseCodes = {
  "none": "None (all rights reserved)",
  "cc0": "CC0 (public domain)",
  "cc-by": "CC-BY (attribution)",
  "cc-by-nc": "CC-BY-NC (attribution, non-commercial)",
  "cc-by-nc-sa": "CC-BY-NC-SA (attribution, non-commercial, share-alike)",
  "cc-by-nc-nd": "CC-BY-NC-ND (attribution, non-commercial, no derivatives)",
  "cc-by-nd": "CC-BY-ND (attribution, no derivatives)",
  "cc-by-sa": "CC-BY-SA (attribution, share-alike)",
};

export type UpsertSightingResponse = {
  id: string;
  t: Timestamp;
}
