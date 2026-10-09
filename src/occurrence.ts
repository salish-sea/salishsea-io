import Point from "ol/geom/Point.js";
import { fromLonLat } from "ol/proj.js";
import Feature from "ol/Feature.js";
import type { Contributor, Occurrence } from "./types.ts";


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

export function canEdit(occurrence: Occurrence, contributor: Contributor): boolean {
  if (occurrence.contributor_id === contributor.id)
    return true;
  if (contributor.editor)
    return true;
  return false;
}
