import type {FerryLocationProperties} from './server/ferries.ts'
import type { SightingProperties } from './server/temporal-features.ts';
export type { SightingProperties } from './server/temporal-features.ts';
export type {FerryLocationProperties} from './server/ferries.ts';
import type { TravelLineProperties } from './server/travel.ts';


export type FeatureProperties = FerryLocationProperties | SightingProperties | TravelLineProperties;

export type Extent = [number, number, number, number];
