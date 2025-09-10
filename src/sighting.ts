import type { Database } from "./database.types.ts";
import { type OverrideProperties, type SetNonNullable, type SetNonNullableDeep } from 'type-fest';

type DBSighting = Database['public']['Functions']['presence_on_date']['Returns'][number];
type PresenceTaxon = SetNonNullable<Database['public']['CompositeTypes']['taxon'], 'scientific_name'>;
type RequiredSighting = SetNonNullableDeep<
  DBSighting,
  'attribution' | 'id' | 'individuals' | 'latitude' | 'longitude' | 'observed_at' | 'photos' | 'symbol' | 'taxon'
>;
type SightingPhoto = SetNonNullable<RequiredSighting['photos'][number], 'src'>;
export type Sighting = OverrideProperties<RequiredSighting, {photos: SightingPhoto[], taxon: PresenceTaxon}>;
