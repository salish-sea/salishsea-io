import Style from 'ol/style/Style.js';
import CircleStyle from 'ol/style/Circle.js';
import Fill from 'ol/style/Fill.js';
import Stroke from 'ol/style/Stroke.js';
import Text from 'ol/style/Text.js';
import type { FeatureLike } from 'ol/Feature.js';
import { Circle, LineString, Point } from 'ol/geom.js';
import type Feature from 'ol/Feature.js';
import Icon from 'ol/style/Icon.js';
import arrowPNG from './assets/arrow.png';
import hydrophoneIcon from './assets/hydrophone-default.svg?url';
import { directionToRads } from './direction.ts';
import type { Occurrence } from './supabase.ts';
import { symbolFor } from './identifiers.ts';

const black = '#000000';
const yellow = '#ffff00';
const transparentWhite = 'rgba(255, 255, 255, 0.4)';
const solidBlue = '#3399CC';
const hour_in_ms = 60 * 60 * 1000;

export const sighterStyle = new Style({
  text: new Text({
    declutterMode: 'none',
    text: '👁️‍🗨️',
  }),
});
const editSighterStyle = sighterStyle.clone();
editSighterStyle.setStroke(new Stroke({color: yellow, width: 3}));
editSighterStyle.setFill(new Fill({color: yellow}));

export const bearingStyle = (feature: Feature<LineString>) => {
  const styles = [
    new Style({
      stroke: new Stroke({
        color: '#0000ff',
        lineDash: [3, 6],
        width: 1.5,
      }),
    }),
  ];

  const {bearing, distance} = feature.getProperties() as {bearing: number | null, distance: number | null}
  if (bearing && distance) {
    styles.push(new Style({
      text: new Text({
        backgroundFill: new Fill({color: 'rgba(240, 240, 240, 0.85)'}),
        text: `${distance.toFixed(3)} km at ${bearing.toFixed(0)}°`,
      }),
    }));
  }
  return styles;
};

export const occurrenceStyle = (occurrence: Occurrence, isSelected = false) => {
  const {direction, identifiers} = occurrence;
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
      image: new CircleStyle({
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
        text: symbolFor(occurrence),
        textBaseline: 'middle',
      }),
    }),
  ];
  // TODO: Add sighting time
  if (identifiers && identifiers.length) {
    styles.push(new Style({
      text: new Text({
        backgroundFill: new Fill({color: 'rgba(255, 255, 255, 0.8)'}),
        declutterMode: 'obstacle',
        offsetX: 10,
        padding: [1, 1, 0, 1],
        text: identifiers.join(', '),
        textAlign: 'left',
      }),
    }));
  }
  if (direction) {
    styles.push(new Style({
      text: new Text({
        font: '14px monospace',
        rotation: directionToRads(direction),
        text: ' ⇢',
        textAlign: 'left',
      }),
    }));
  }
  return styles;
}

export const selectedObservationStyle = (observation: FeatureLike) => {
  const sighting = observation.getProperties() as Occurrence;
  return occurrenceStyle(sighting, true);
};

export const travelStyle = (feature: Feature<LineString>, resolution: number) => {
  if (resolution > 100)
    return;
  const lineString = feature.getGeometry()!;
  const styles: Style[] = [];

  if (lineString.getLength() > 1)
    styles.push(new Style({
      stroke: new Stroke({
        color: '#ffcc33',
        width: 2,
      }),
    }));
  lineString.forEachSegment(function (a, b) {
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
  const meanTravelSpeed = feature.get('mean_travel_speed') as number | undefined;
  if (meanTravelSpeed) {
    const lastCoordinate = lineString.getLastCoordinate();
    const lastEpochMs = feature.get('last_epoch_ms');
    const ageHours = (new Date().valueOf() - lastEpochMs) / hour_in_ms;
    if (ageHours < 6) {
      const imputedDistanceM = ageHours * meanTravelSpeed * 1000;
      const opacity = (3 / (3 + 4 * ageHours * ageHours)).toFixed(2);
      styles.push(new Style({
        geometry: new Circle(lastCoordinate, imputedDistanceM, 'XY'),
        stroke: new Stroke({
          color: `rgba(200, 0, 0, ${opacity})`,
          width: 1,
        }),
      }));
    }
  }
  return styles;
}

export const editStyle = (feature: FeatureLike) => {
  const kind = feature.get('kind') as string | undefined;
  if (kind === 'Sighter')
    return editSighterStyle;
  else if (kind === 'Sighting')
    return selectedObservationStyle(feature);
}

export const viewingLocationStyle = (location: FeatureLike) => {
  const fill = new Fill({color: transparentWhite});
  const stroke = new Stroke({color: solidBlue, width: 1.25});
  const text = location.get('name');
  return [
    new Style({
      image: new CircleStyle({radius: 4, fill, stroke}),
      fill,
      stroke,
    }),
    new Style({
      text: new Text({
        declutterMode: 'obstacle',
        fill: new Fill({color: black}),
        font: '10px monospace',
        offsetX: 10,
        padding: [1, 1, 0, 1],
        text,
        textAlign: 'left',
        textBaseline: 'middle',
      }),
    }),
  ];
}

export const hydrophoneStyle = (_hydrophone: FeatureLike) => {
  return new Style({
    image: new Icon({
      src: hydrophoneIcon,
    }),
  })
}
