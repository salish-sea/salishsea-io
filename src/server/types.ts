import type {FerryLocationProperties} from './ferries.ts'
export type {FerryLocationProperties} from './ferries.ts';
import type {SightingProperties} from './maplify.ts'
export type {SightingProperties} from './maplify.ts';

export type FeatureProperties = FerryLocationProperties | SightingProperties;

export type Identification = {
  species: string;
  subspecies: string | null;
  ecotype: string | null;
  pod: string | null;
  individuals: string[];
};
