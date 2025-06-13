import type { Feature, FeatureCollection } from 'geojson';
import {writeFileSync} from 'node:fs';


const assetPath = 'src/assets/orcasound-hydrophones.geojson';
const graphqlEndpoint = 'https://live.orcasound.net/graphql';
// const graphqlEndpoint = 'http://localhost:8888/graphql';

console.debug(`Fetching map from ${graphqlEndpoint}`);
const request = new Request(graphqlEndpoint, {
  body: JSON.stringify({query:`
    query feeds($sort: [FeedSortInput]) {
  feeds(sort: $sort) {
    id
    name
    slug
    nodeName
    latLng {
      lat
      lng
    }
    imageUrl
    thumbUrl
    mapUrl
    bucket
    online
  }
}
    `}),
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
  },
  method: 'POST',
});
const response = await fetch(request);
if (response.status !== 200)
  throw `Error fetching endpoints: ${response.statusText}`;
const body: Payload = await response.json();

const features: Feature[] = body.data.feeds.map(feed => {
  const {lat, lng} = feed.latLng;
  return {
    id: `orcasound:${feed.id}`,
    geometry: {type: 'Point', coordinates: [lng, lat]},
    properties: {
      kind: 'Hydrophone',
      url: `https://live.orcasound.net/listen/${feed.slug}`,
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
  id: string;
  imageUrl: string;
  latLng: {lat: number; lng: number};
  mapUrl: string;
  name: string;
  online: boolean;
  slug: string;
};
type Payload = {
  data: {
    feeds: Feed[];
  };
};
