import GeoJSON from 'ol/format/GeoJSON';
import VectorSource from 'ol/source/Vector';
import { all } from 'ol/loadingstrategy';

const baseURL = '/observations';

export default class ObservationSource extends VectorSource {
  constructor() {
    const url = baseURL;
    super({format: new GeoJSON(), strategy: all, url});
  }
}
