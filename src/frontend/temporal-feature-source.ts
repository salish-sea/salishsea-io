import GeoJSON from 'ol/format/GeoJSON.js';
import VectorSource from 'ol/source/Vector.js';
import { all } from 'ol/loadingstrategy.js';
import Feature from 'ol/Feature.js';
import { queryStringAppend } from './util.ts';
import type Geometry from 'ol/geom/Geometry.js';

const baseURL = '/api/temporal-features';

export default class TemporalFeatureSource extends VectorSource<Feature<Geometry>> {
  constructor(coordinates: {date: string}) {
    const url = () => {
      return queryStringAppend(baseURL, {d: coordinates.date});
    };
    super({format: new GeoJSON<Feature<Geometry>>(), strategy: all, url});
  }
}
