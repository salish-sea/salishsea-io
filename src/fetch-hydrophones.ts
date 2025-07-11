import type { Feature, FeatureCollection } from 'geojson';
import {writeFileSync} from 'node:fs';


const assetPath = 'src/assets/orcasound-hydrophones.geojson';
const endpoint = 'https://live.orcasound.net/api/json/feeds';

console.debug(`Fetching map from ${endpoint}`);
const response = await fetch(endpoint);
if (response.status !== 200)
  throw `Error fetching endpoints: ${response.statusText}`;
const body: Payload = await response.json();

const features: Feature[] = body.data
  .filter(feed => feed.attributes.visible)
  .map(feed => {
    const {lat, lng} = feed.attributes.lat_lng;
    return {
      id: `orcasound:${feed.id}`,
      geometry: {type: 'Point', coordinates: [lng, lat]},
      properties: {
        kind: 'Hydrophone',
        url: `https://live.orcasound.net/listen/${feed.attributes.slug}`,
      },
      type: 'Feature',
    };
  });
const collection: FeatureCollection = {
  type: 'FeatureCollection',
  features,
}
writeFileSync(assetPath, JSON.stringify(collection) + '\n');

type Feed = {
  attributes: {
    name: string;
    visible: boolean;
    slug: string;
    intro_html: string;
    lat_lng: {
      lng: number;
      lat: number;
    };
  };
  id: string;
  type: 'feed';
};
type Payload = {
  data: Feed[];
};
