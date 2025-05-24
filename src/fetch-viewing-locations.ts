import { XMLParser } from 'fast-xml-parser';
import type { Feature, FeatureCollection } from 'geojson';
import {writeFileSync} from 'node:fs';


// https://www.google.com/maps/d/u/0/kml?mid=1xIsepZY5h_8oA2nd6IwJN-Y7lhk
const assetPath = 'src/assets/orcanetwork-viewing-locations.geojson';
const remoteMapUrl = 'https://www.google.com/maps/d/kml?forcekml=1&mid=1xIsepZY5h_8oA2nd6IwJN-Y7lhk';
const parser = new XMLParser();

console.debug(`Fetching map from ${remoteMapUrl}`);
const mapResponse = await fetch(remoteMapUrl);
const map: Kml = parser.parse(await mapResponse.text());
const attribution = map.kml.Document.description;
console.info(`Attribution line is:\n${attribution}`);

const features: Feature[] = map.kml.Document.Folder.Placemark.map(placemark => {
  const [longitude, latitude] = placemark.Point.coordinates.split(',').map(parseFloat);
  const name = placemark.name.replace(/ \(.+\).*$/, '');
  return {
    id: `orcanetworkviewinglocation:${placemark.name}`,
    geometry: {type: 'Point', coordinates: [longitude!, latitude!]},
    properties: {name},
    type: 'Feature',
  };
});
const collection: FeatureCollection = {
  type: 'FeatureCollection',
  features,
}
writeFileSync(assetPath, JSON.stringify(collection));

type Kml = {
  kml: {
    Document: {
      description: string;
      Folder: {
        Placemark: Placemark[];
      };
    };
  };
};

type Placemark = {
  name: string;
  description: string;
  Point: {
    coordinates: string; // e.g. '-123.154163,48.514671,0'
  };
};
