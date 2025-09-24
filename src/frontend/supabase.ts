import { createClient } from '@supabase/supabase-js';
import { type Database } from '../../database.types.ts';
import type { Merge, MergeDeep, OverrideProperties, SetNonNullable, SetNonNullableDeep } from 'type-fest';

export type TravelDirection = Database['public']['Enums']['travel_direction'];
type DBOccurrence = Database['public']['Views']['occurrences']['Row'];
type OccurrenceTaxon = SetNonNullable<Database['public']['CompositeTypes']['taxon'], 'scientific_name'>;
type PatchedOccurrence = SetNonNullableDeep<
  DBOccurrence,
  'id' | 'identifiers' | 'location' | 'location.lat' | 'location.lon' | 'observed_at' | 'photos' | 'taxon'
>;
type OccurrencePhoto = SetNonNullable<PatchedOccurrence['photos'][number], 'src'>;
export type Occurrence = OverrideProperties<PatchedOccurrence, {photos: OccurrencePhoto[], taxon: OccurrenceTaxon}>;
export type UpsertObservationArgs = Merge<Database['public']['Functions']['upsert_observation']['Args'], {
  accuracy: number | null;
  count: number | null;
  direction: TravelDirection | null;
  observed_from: Database['public']['CompositeTypes']['lon_lat'] | null;
  photos: OccurrencePhoto[],
  url: string | null;
}>;
export type License = Database['public']['Enums']['license'];
type PatchedDatabase = MergeDeep<Database, {
  public: {
    Functions: {
      occurrences_on_date: {
        Return: Occurrence[];
      };
      upsert_observation: {
        Args: UpsertObservationArgs;
      };
    };
    CompositeTypes: {
      lon_lat: {
        lon: number;
        lat: number;
      };
    };
  };
}>;

const publishableKey = import.meta.env.VITE_SUPABASE_KEY;
if (!publishableKey)
  throw new Error("Please set VITE_SUPABASE_KEY");

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
if (!supabaseUrl)
  throw new Error("Please set VITE_SUPABSAE_URL");

export const supabase = createClient<PatchedDatabase, 'public'>(
  supabaseUrl,
  publishableKey,
);
