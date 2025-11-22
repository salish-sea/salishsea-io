import { createClient } from '@supabase/supabase-js';
import { type Database } from '../database.types.ts';
import type { OverrideProperties, SetNonNullable, SetNonNullableDeep } from 'type-fest';

export type License = Database['public']['Enums']['license'];
export type TravelDirection = Database['public']['Enums']['travel_direction'];

type PatchedDatabase = SetNonNullableDeep<
  Database,
  'public.CompositeTypes.lat_lng.lat' | 'public.CompositeTypes.lat_lng.lng' |
  'public.CompositeTypes.lon_lat.lat' | 'public.CompositeTypes.lon_lat.lon' |
  'public.CompositeTypes.taxon.scientific_name' |
  'public.Views.occurrences.Row.photos' |
  'public.Views.occurrences.Row.observed_at'
>;
type LonLat = {lat: number; lon: number;};
type DBOccurrence = PatchedDatabase['public']['Views']['occurrences']['Row'];
type Occurrence1 = SetNonNullable<
  DBOccurrence,
  'id' | 'location' | 'observed_at' | 'photos' | 'taxon'
>;
type Taxon = SetNonNullable<Database['public']['CompositeTypes']['taxon'], 'scientific_name'>;
export type OccurrencePhoto = SetNonNullable<Occurrence1['photos'][number], 'src'>;
export type Occurrence = OverrideProperties<Occurrence1, {
  location: LonLat;
  observed_at: string;
  observed_from: LonLat | null;
  photos: OccurrencePhoto[];
  taxon: Taxon;
}> & {
  isFirst?: true;
  isLast?: true;
  observed_at_ms: number;
};


type DBUpsertObservationArgs = PatchedDatabase['public']['Functions']['upsert_observation']['Args'];
export type UpsertObservationArgs = OverrideProperties<
  DBUpsertObservationArgs,
  {
    accuracy: DBUpsertObservationArgs['accuracy'] | null;
    count: DBUpsertObservationArgs['count'] | null;
    direction: DBUpsertObservationArgs['direction'] | null;
    observed_from: DBUpsertObservationArgs['observed_from'] | null;
  }
>;

const publishableKey = import.meta.env.VITE_SUPABASE_KEY;
if (!publishableKey)
  throw new Error("Please set VITE_SUPABASE_KEY");

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
if (!supabaseUrl)
  throw new Error("Please set VITE_SUPABASE_URL");

export const supabase = createClient<PatchedDatabase, 'public'>(
  supabaseUrl,
  publishableKey,
);
