import type {FerryLocationProperties} from './ferries.ts'
export type {FerryLocationProperties} from './ferries.ts';
import type {SightingProperties} from './maplify.ts'
export type {SightingProperties} from './maplify.ts';
import type { ObservationProperties } from './inaturalist.ts';
import type { TravelLineProperties } from './travel.ts';
export type {ObservationProperties} from './inaturalist.ts';

export type FeatureProperties = FerryLocationProperties | SightingProperties | ObservationProperties | TravelLineProperties;
