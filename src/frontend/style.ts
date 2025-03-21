import Style from 'ol/style/Style.js';
import Circle from 'ol/style/Circle.js';
import Fill from 'ol/style/Fill.js';
import Stroke from 'ol/style/Stroke.js';
import Text from 'ol/style/Text.js';
import type {FeatureProperties, FerryLocationProperties, SightingProperties} from '../types.ts';
import type { FeatureLike } from 'ol/Feature.js';
import TextStyle from 'ol/style/Text.js';
import { Point, type LineString } from 'ol/geom.js';
import type Feature from 'ol/Feature.js';
import Icon from 'ol/style/Icon.js';
import arrowPNG from '../assets/arrow.png';

const black = '#000000';
const yellow = '#ffff00';
const transparentWhite = 'rgba(255, 255, 255, 0.4)';
const solidBlue = '#3399CC';

const observationStyle2 = ({individuals, symbol}: SightingProperties, isSelected: boolean) => {
  let fill: Fill;
  let stroke: Stroke;
  if (isSelected) {
    fill = new Fill({color: yellow});
    stroke = new Stroke({color: yellow, width: 3});
  } else {
    fill = new Fill({color: transparentWhite});
    stroke = new Stroke({color: solidBlue, width: 1.25});
  }
  const styles = [
    new Style({
      image: new Circle({
        radius: 6,
        fill,
        stroke,
      }),
      fill,
      stroke,
    }),
    new Style({
      text: new Text({
        declutterMode: 'none',
        fill: new Fill({color: black}),
        font: '10px monospace',
        offsetY: 1.5,
        text: symbol,
        textBaseline: 'middle',
      }),
    }),
  ];
  if (individuals.length) {
    styles.push(new Style({
      text: new Text({
        backgroundFill: new Fill({color: 'rgba(255, 255, 255, 0.8)'}),
        declutterMode: 'obstacle',
        offsetX: 10,
        padding: [1, 1, 0, 1],
        text: individuals.join(', '),
        textAlign: 'left',
      }),
    }));
  }
  return styles;
}

const observationStyle = (properties: SightingProperties) => {
  return observationStyle2(properties, false);
};

// const pliantObservationStyle = (observation: FeatureLike) => {
//   return observationStyle2(observation, true);
// };

export const selectedObservationStyle = (observation: FeatureLike) => {
  const properties = observation.getProperties() as SightingProperties;
  return observationStyle2(properties, true);
};


const ferryStyle = ({symbol}: FerryLocationProperties) => {
  return new Style({
    text: new TextStyle({text: symbol}),
  });
}

export const travelStyle = (feature: Feature<LineString>, resolution: number) => {
  if (resolution > 100)
    return;

  const styles = [
    // linestring
    new Style({
      stroke: new Stroke({
        color: '#ffcc33',
        width: 2,
      }),
    }),
  ];
  feature.getGeometry()!.forEachSegment(function (a, b) {
    const start = a as [number, number];
    const end = b as [number, number];
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const rotation = Math.atan2(dy, dx);
    // arrows
    styles.push(
      new Style({
        geometry: new Point([(end[0] + start[0]) / 2, (end[1] + start[1]) / 2]),
        image: new Icon({
          src: arrowPNG,
          anchor: [0.75, 0.5],
          rotateWithView: true,
          rotation: -rotation,
        }),
      }),
    );
  });
  return styles;
}

export const featureStyle = (feature: FeatureLike, resolution: number) => {
  const properties = feature.getProperties() as FeatureProperties;
  if (properties.kind === 'Ferry') {
    return ferryStyle(properties);
  } else if (properties.kind === 'TravelLine') {
    return travelStyle(feature as Feature<LineString>, resolution);
  } else {
    return observationStyle(properties);
  }
}
