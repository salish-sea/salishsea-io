import { type Database } from '../database.types.ts';
import type { MergeDeep, OverrideProperties, SetNonNullable, SetNonNullableDeep } from 'type-fest';

export type Contributor = Database['public']['Tables']['contributors']['Row'];
export type License = Database['public']['Enums']['license'];
export type TravelDirection = Database['public']['Enums']['travel_direction'];

type NonNullablePatched = SetNonNullableDeep<
  Database,
  'public.CompositeTypes.lat_lng.lat' | 'public.CompositeTypes.lat_lng.lng' |
  'public.CompositeTypes.lon_lat.lat' | 'public.CompositeTypes.lon_lat.lon' |
  'public.CompositeTypes.taxon.scientific_name' |
  'public.Views.occurrences.Row.photos' |
  'public.Views.occurrences.Row.observed_at'
>;

/**
 * The generator emits every function parameter as non-nullable. Postgres
 * function parameters are nullable unless the body makes them otherwise, and
 * `public.upsert_observation` (migration
 * [20260207000253](../supabase/migrations/20260207000253_fix_upsert_observation.sql))
 * takes null for all four of these: `accuracy` it accepts and does not store at
 * all, and the other three reach nullable columns — `observed_from` through an
 * `ST_Point` that yields NULL for a NULL input. The report form has always sent
 * null for each of them, so the generated type was the thing that was wrong.
 */
export type PatchedDatabase = MergeDeep<NonNullablePatched, {
  public: {Functions: {upsert_observation: {Args: {
    accuracy: number | null;
    count: number | null;
    direction: Database['public']['Enums']['travel_direction'] | null;
    observed_from: Database['public']['CompositeTypes']['lon_lat'] | null;
  }}}};
}>;
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
  observed_at_ms: number;
} & SegmentPlacement;

/**
 * Where an occurrence sits in its travel segment, hung on the map feature by
 * {@link segment2features} and read back out by the style.
 *
 * It is not part of the record. A sighting has no intrinsic "last": the same
 * occurrence is a segment head on a day's map and a mid-track point once the
 * next sighting arrives. It lives on the Occurrence because the style receives
 * `feature.getProperties()`, and OpenLayers gives it no other channel.
 *
 * The head is the LAST point, not the first — the most recent place the animal
 * was, which is what a reader is looking for and what the label speaks for.
 */
export type SegmentPlacement = {
  isFirst?: true;
  isLast?: true;
  /** Occurrences in the segment. 1 for a singleton, which is a segment of one. */
  segmentLength?: number;
  /** Identifiers pooled across the whole segment, deduplicated and sorted. */
  segmentIdentifiers?: string[];
  /** The identity line for the whole track — see `labelForSegment`. */
  segmentIdentity?: string;
  /** First sighting to last, in hours. 0 for a singleton. */
  segmentSpanHours?: number;
};


/**
 * What `upsert_observation` accepts — the one write path the app has. It is the
 * client's own argument type, not a parallel shape that happens to resemble it,
 * so a payload the compiler accepts here is a payload PostgREST will accept.
 */
export type UpsertObservationArgs = PatchedDatabase['public']['Functions']['upsert_observation']['Args'];
