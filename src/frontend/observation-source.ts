import GeoJSON from 'ol/format/GeoJSON';
import VectorSource from 'ol/source/Vector';
import { all } from 'ol/loadingstrategy';
import Point from 'ol/geom/Point';
import Feature from 'ol/Feature';
import { Temporal } from 'temporal-polyfill';
import { queryStringAppend } from './util';

const baseURL = '/temporal-features';

export default class ObservationSource extends VectorSource<Feature<Point>> {
  constructor(coordinates: {time: Temporal.Instant}) {
    const url = () => queryStringAppend(baseURL, {t: coordinates.time});
    super({format: new GeoJSON<Feature<Point>>(), strategy: all, url});
  }
}
