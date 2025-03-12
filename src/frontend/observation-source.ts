import GeoJSON from 'ol/format/GeoJSON';
import VectorSource from 'ol/source/Vector';
import { all } from 'ol/loadingstrategy';
import Point from 'ol/geom/Point';
import Feature from 'ol/Feature';

const baseURL = '/temporal-features';

export default class ObservationSource extends VectorSource<Feature<Point>> {
  constructor() {
    const url = baseURL;
    super({format: new GeoJSON<Feature<Point>>(), strategy: all, url});
  }
}
