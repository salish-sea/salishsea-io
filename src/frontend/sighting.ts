import Feature from "ol/Feature.js";
import { Point } from "ol/geom.js";
import type { Sighting } from "../sighting.ts";


// export type SightingFeature = OverrideProperties<Feature<Point>, {
//   getProperties: () => Sighting;
// }>;

export function sighting2feature(sighting: Sighting): Feature<Point> {
  const point = new Point([sighting.longitude, sighting.latitude]);
  const feature = new Feature(point);
  feature.setId(sighting.id);
  feature.setProperties(sighting);

  return feature;
}
