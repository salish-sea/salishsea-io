import GeoJSON from 'ol/format/GeoJSON.js';
import VectorSource from 'ol/source/Vector.js';
import { all } from 'ol/loadingstrategy.js';
import Point from 'ol/geom/Point.js';
import Feature from 'ol/Feature.js';
import { Temporal } from 'temporal-polyfill';
import { queryStringAppend } from './util.ts';

const baseURL = '/temporal-features';

export default class ObservationSource extends VectorSource<Feature<Point>> {
  constructor(coordinates: {time: Temporal.Instant}) {
    const url = () => queryStringAppend(baseURL, {t: coordinates.time});
    super({format: new GeoJSON<Feature<Point>>(), strategy: all, url});
  }
}
