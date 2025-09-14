import Point from "ol/geom/Point.js";
import type { Database } from "../database.types.ts";
import type { OverrideProperties, SetNonNullable, SetNonNullableDeep } from 'type-fest';
import { fromLonLat } from "ol/proj.js";
import Feature from "ol/Feature.js";

type DBOccurrence = Database['public']['Functions']['occurrences_on_date']['Returns'][number];
type OccurrenceTaxon = SetNonNullable<Database['public']['CompositeTypes']['taxon'], 'scientific_name'>;
type RequiredPresence = SetNonNullableDeep<
  DBOccurrence,
  'id' | 'individuals' | 'latitude' | 'longitude' | 'observed_at' | 'photos' | 'taxon'
>;
type OccurrencePhoto = SetNonNullable<RequiredPresence['photos'][number], 'src'>;
export type Occurrence = OverrideProperties<RequiredPresence, {photos: OccurrencePhoto[], taxon: OccurrenceTaxon}> & {
  kind?: 'Sighter'
};

export function occurrence2feature(occurrence: Occurrence): Feature<Point> {
  const point = new Point(fromLonLat([occurrence.longitude, occurrence.latitude]));
  const feature = new Feature(point);
  feature.setId(occurrence.id);
  feature.setProperties(occurrence);

  return feature;
}
