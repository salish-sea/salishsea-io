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
features.push({
  id: `whalemuseum:limekilnhydrophone`,
  geometry: {type: 'Point', coordinates: [-123.153, 48.516]},
  properties: {
    kind: 'Hydrophone',
    url: 'https://www.youtube.com/thewhalemuseum/live',
  },
  type: 'Feature',
});
features.push({
  id: `simres:monarchheadhydrophone`,
  geometry: {type: 'Point', coordinates: [-123.086, 48.766]},
  properties: {
    kind: 'Hydrophone',
    url: 'https://simres.ca/',
  },
  type: 'Feature',
});
features.push({
  id: `raincoast:penderhydrophone`,
  geometry: {type: 'Point', coordinates: [-123.199, 48.730]},
  properties: {
    kind: 'Hydrophone',
    url: 'https://www.youtube.com/live/v6YhBAIJqGM',
  },
  type: 'Feature',
});
features.push({
  id: `raincoast:marygordonlisteningstation`,
  geometry: {type: 'Point', coordinates: [-124, 48.525]},
  properties: {
    kind: 'Hydrophone',
    url: 'https://www.youtube.com/live/U8mgGY9KOdw',
  },
  type: 'Feature',
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
