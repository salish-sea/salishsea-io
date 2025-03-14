import type {Properties as FerryProperties} from './ferries.ts'
export type {Properties as FerryProperties} from './ferries.ts';
import type {Properties as SightingProperties} from './maplify.ts'
export type {Properties as SightingProperties} from './maplify.ts';

export type FeatureProperties = FerryProperties | SightingProperties;
