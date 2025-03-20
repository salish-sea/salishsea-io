import Style from 'ol/style/Style.js';
import Circle from 'ol/style/Circle.js';
import Fill from 'ol/style/Fill.js';
import Stroke from 'ol/style/Stroke.js';
import Text from 'ol/style/Text.js';
import type {FeatureProperties, FerryLocationProperties, SightingProperties} from '../types.ts';
import type { FeatureLike } from 'ol/Feature.js';
import TextStyle from 'ol/style/Text.js';
import { Temporal } from 'temporal-polyfill';
import { Point, type LineString } from 'ol/geom.js';
import type Feature from 'ol/Feature.js';
import Icon from 'ol/style/Icon.js';
import arrowPNG from '../assets/arrow.png';

const black = '#000000';
const white = '#ffffff';
const transparentWhite = 'rgba(255, 255, 255, 0.4)';
const solidBlue = '#3399CC';

const observationStyle2 = ({symbol}: SightingProperties, isSelected: boolean) => {
  const fill = new Fill({color: isSelected ? solidBlue : transparentWhite});
  const stroke = new Stroke({color: isSelected ? transparentWhite : solidBlue, width: 1.25});
  return [
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
        fill: new Fill({color: isSelected ? white : black}),
        font: '10px monospace',
        offsetY: 1.5,
        text: symbol,
        textBaseline: 'middle',
      }),
    }),
  ];
}

const observationStyle = (properties: SightingProperties) => {
  return observationStyle2(properties, false);
};

// const pliantObservationStyle = (observation: FeatureLike) => {
//   return observationStyle2(observation, true);
// };

export const selectedObservationStyle = (observation: FeatureLike) => {
  const properties = observation.getProperties() as SightingProperties;
  const {body, count, name, timestamp} = properties;
  const observedAt = Temporal.Instant.fromEpochSeconds(timestamp);
  let text = observedAt.toLocaleString('en-US', {dateStyle: 'short', timeZone: 'PST8PDT', timeStyle: 'short'});
  text += ` ${name}`;
  if (count)
    text += ` (${count})`;
  if (body)
    text += '\n' + body.replaceAll(/(<br>)+/gi, '\n');
  return [
    ...observationStyle2(properties, true),
    new Style({
      text: new Text({
        backgroundFill: new Fill({color: 'rgba(255, 255, 255, 0.8)'}),
        declutterMode: 'obstacle',
        offsetX: 8,
        padding: [2, 2, 2, 2],
        text,
        textAlign: 'left',
      })
    })
  ];
};


const ferryStyle = ({symbol}: FerryLocationProperties) => {
  return new Style({
    text: new TextStyle({text: symbol}),
  });
}

export const travelStyle = (feature: Feature<LineString>, resolution: number) => {
  if (resolution > 80)
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
