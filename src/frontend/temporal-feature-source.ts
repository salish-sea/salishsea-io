import GeoJSON from 'ol/format/GeoJSON.js';
import VectorSource from 'ol/source/Vector.js';
import { all } from 'ol/loadingstrategy.js';
import Feature from 'ol/Feature.js';
import { Temporal } from 'temporal-polyfill';
import { queryStringAppend } from './util.ts';
import type Geometry from 'ol/geom/Geometry.js';

const baseURL = '/temporal-features';

export default class TemporalFeatureSource extends VectorSource<Feature<Geometry>> {
  constructor(coordinates: {time: Temporal.Instant}) {
    const url = () => queryStringAppend(baseURL, {t: coordinates.time});
    super({format: new GeoJSON<Feature<Geometry>>(), strategy: all, url});
  }
}
