import Style from 'ol/style/Style';
import Circle from 'ol/style/Circle';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import Text from 'ol/style/Text';
import type {FeatureProperties, FerryLocationProperties, SightingProperties} from '../server/types.ts';
import { FeatureLike } from 'ol/Feature';
import TextStyle from 'ol/style/Text';

const observationStyle = (props: SightingProperties) => {
  const fill = new Fill({color: 'rgba(255, 255, 255, 0.4)'});
  const stroke = new Stroke({color: '#3399CC'});
  const text = props.taxon[0];
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
        fill: new Fill({color: '#000000'}),
        font: '10px monospace',
        offsetY: 1.5,
        text,
        textBaseline: 'middle',
      })
    }),
  ]
}

const ferryStyle = (_ferryProps: FerryLocationProperties) => {
  return new Style({
    text: new TextStyle({text: '⛴'}),
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
