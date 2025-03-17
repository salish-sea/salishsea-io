import Style from 'ol/style/Style.js';
import Circle from 'ol/style/Circle.js';
import Fill from 'ol/style/Fill.js';
import Stroke from 'ol/style/Stroke.js';
import Text from 'ol/style/Text.js';
import type {FeatureProperties, FerryLocationProperties, SightingProperties} from '../server/types.ts';
import type { FeatureLike } from 'ol/Feature.js';
import TextStyle from 'ol/style/Text.js';
import { Temporal } from 'temporal-polyfill';

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

export const featureStyle = (feature: FeatureLike) => {
  const properties = feature.getProperties() as FeatureProperties;
  if (properties.kind === 'Ferry') {
    return ferryStyle(properties);
  } else {
    return observationStyle(properties);
  }
}
