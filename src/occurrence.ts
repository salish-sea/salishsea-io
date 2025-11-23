import Point from "ol/geom/Point.js";
import { fromLonLat } from "ol/proj.js";
import Feature from "ol/Feature.js";
import { supabase } from "./supabase.ts";
import type { Occurrence } from "./types.ts";


export function occurrence2feature(occurrence: Occurrence): Feature<Point> {
  const {lat, lon} = occurrence.location;
  if (!lon || !lat)
    throw new Error(`Occurrence ${occurrence.id} missing location: ${JSON.stringify(occurrence.location)}`);
  const point = new Point(fromLonLat([lon, lat]));
  const feature = new Feature(point);
  feature.setId(occurrence.id);
  feature.setProperties(occurrence);

  return feature;
}

export async function fetchLastOwnOccurrence(): Promise<Occurrence | null> {
  const {data: occurrence, error} = await supabase
    .from('occurrences')
    .select('*')
    .eq('is_own_observation', true)
    .order('observed_at', {ascending: false})
    .limit(1)
    .maybeSingle<Occurrence>();
  if (error)
    throw new Error(`Couldn't fetch last occurrence: ${error.message || JSON.stringify(error)}`);
  return occurrence;
}
