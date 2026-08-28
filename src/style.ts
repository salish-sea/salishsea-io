import Style from 'ol/style/Style.js';
import CircleStyle from 'ol/style/Circle.js';
import Fill from 'ol/style/Fill.js';
import Stroke from 'ol/style/Stroke.js';
import Text from 'ol/style/Text.js';
import type { FeatureLike } from 'ol/Feature.js';
import { Circle, LineString, Point } from 'ol/geom.js';
import type Feature from 'ol/Feature.js';
import Icon from 'ol/style/Icon.js';
import travelArrowIcon from './assets/travel-arrow.svg?url';
import hydrophoneIcon from './assets/hydrophone-default.svg?url';
import salmonCountingSiteIcon from './assets/salmon-counting-site.svg?url';
import viewingLocationIcon from './assets/viewing-location.svg?url';
import { directionToRads } from './direction.ts';
import type { Occurrence } from './types.ts';
import { GROUPS, labelFor, taxonGroup, trackSummary } from './symbology.ts';
import { Temporal } from 'temporal-polyfill';

const black = '#000000';
const yellow = '#ffff00';
const transparentWhite = 'rgba(255, 255, 255, 0.4)';
const hour_in_ms = 60 * 60 * 1000;

let nowOverride: Date | null = null;
(() => {
  const params = new URLSearchParams(document.location.search);
  const d = params.get('d');
  const t = params.get('t');
  if (d && t) {
    try {
      const dateTime = Temporal.PlainDate.from(d).toZonedDateTime({timeZone: 'PST8PDT', plainTime: t});
      nowOverride = new Date(dateTime.epochMilliseconds);
    } catch (e) {
      console.error(e);
    }
  }
})();

function now() {
  return nowOverride || new Date();
}

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

/**
 * `#RRGGBB` at a given alpha. The palette is authored as hex because that is how
 * Okabe–Ito is published; the map needs it translucent.
 */
function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * The label a segment head carries, over one or two lines.
 *
 * ONE `Text`, not two stacked styles, and a plain string rather than
 * OpenLayers' rich-text form. The rich-text form — an array of alternating text
 * and font — does NOT honour `\n`; it lays every chunk out inline, which
 * rendered "Humpback Seen 2× in under an hour" on a single line. A plain string
 * breaks correctly, at the cost of a per-line font. One `Text` also keeps the
 * label a single declutter unit with a single background box, so the two lines
 * cannot be separated or half-hidden from each other.
 */
function labelStyle(text: string, color: string, secondLine?: string): Style {
  return new Style({
    text: new Text({
      // Near-opaque. At 88% a marker underneath showed through as a pale
      // smudge, which reads as a rendering fault; a label that lands on a
      // neighbour should look like a label, and the marker is still there when
      // its own label is the one that survives decluttering.
      backgroundFill: new Fill({color: 'rgba(255, 255, 255, 0.96)'}),
      backgroundStroke: new Stroke({color: rgba(color, 0.5), width: 1}),
      declutterMode: 'declutter',
      fill: new Fill({color: '#111827'}),
      font: '600 11px system-ui, sans-serif',
      offsetX: 11,
      padding: [2, 4, 1, 4],
      text: secondLine ? `${text}\n${secondLine}` : text,
      textAlign: 'left',
      textBaseline: 'middle',
    }),
  });
}

/**
 * Decision [029](../docs/decisions/029-map-symbology.md): colour carries the
 * taxon group, the label carries the specifics, the track is supporting.
 *
 * Every occurrence is a dot filled by group. The SEGMENT HEAD — the most recent
 * point of a track, and for a singleton the only point — is larger, ringed in
 * white, and carries one label speaking for the whole track. That is what
 * replaces the old red ring for `isLast`: the last observation is still the
 * emphasised one (GH #123), by size and by being the thing that gets to say
 * something, rather than by a second colour competing with the taxon palette.
 *
 * Labelling every head is affordable, which is the finding 029 most wants
 * preserved: hoisting labels to heads saves almost nothing, because a singleton
 * is a segment of one. What made the map readable was shorter names, not fewer
 * labels.
 */
export const occurrenceStyle = (occurrence: Occurrence, isSelected = false) => {
  const {direction, isLast, segmentIdentifiers, segmentLength, segmentSpanHours} = occurrence;
  const {color} = GROUPS[taxonGroup(occurrence.taxon.scientific_name)];
  const isHead = !!isLast;

  const styles = [
    new Style({
      image: new CircleStyle({
        // The dot never declutters. Hiding a marker would hide a sighting;
        // hiding its label only costs you the name, and the panel still has it.
        //
        // NOT 'obstacle', which is the reading that looks right and is not: an
        // obstacle reserves its own footprint, and the label is anchored to the
        // dot it belongs to, so every label collided with its own marker and
        // the map lost all of them at once.
        declutterMode: 'none',
        radius: isSelected ? 9 : isHead ? 7 : 4.5,
        fill: new Fill({color: isSelected ? 'rgba(255, 255, 0, 0.5)' : rgba(color, isHead ? 0.95 : 0.75)}),
        stroke: new Stroke({
          color: isSelected ? yellow : isHead ? '#ffffff' : rgba(color, 0.9),
          width: isSelected ? 3 : isHead ? 2 : 1,
        }),
      }),
    }),
  ];

  if (isHead) {
    // Pooled over the track, not taken from the head alone: a J-pod encounter
    // reported with the matriline on the first sighting and not the second
    // still names it.
    const identifiers = segmentIdentifiers ?? occurrence.identifiers;
    const identity = identifiers?.length
      ? `${labelFor(occurrence)} · ${identifiers.join(', ')}`
      : labelFor(occurrence);
    const points = segmentLength ?? 1;
    styles.push(labelStyle(
      identity,
      color,
      points > 1 ? trackSummary(points, segmentSpanHours ?? 0) : undefined,
    ));
  }

  if (direction) {
    styles.push(new Style({
      text: new Text({
        declutterMode: 'none',
        fill: new Fill({color}),
        font: '15px monospace',
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

/**
 * Coarser than this, a travel line is drawn but not annotated: no direction
 * arrows, no imputed present position.
 *
 * The line itself has no gate any more. It used to — `resolution > 100`
 * returned early for the whole style — and the default view of the Salish Sea
 * sits near 500 m/px, so travel lines did not draw at all until you zoomed in
 * past ~11. [#271](https://github.com/salish-sea/salishsea-io/issues/271) reads
 * as "you can hardly see them"; half of it was that they were absent rather
 * than faint (salish-fll.4).
 *
 * The annotations keep the threshold. They are fixed-size marks on a line whose
 * length shrinks with zoom: at the default view a whole segment is a few dozen
 * pixels, so a midpoint arrow covers the hop it annotates, and the "now at
 * 6.8km/h" circle is a claim about the next half hour that belongs at the zoom
 * where you would act on it.
 */
const TRAVEL_DETAIL_MAX_RESOLUTION = 100;

export const travelStyle = (feature: Feature<LineString>, resolution: number) => {
  const lineString = feature.getGeometry()!;
  const styles: Style[] = [];

  if (lineString.getLength() > 1) {
    // A casing under the line, not a heavier line. 2px alone disappears into
    // the Esri basemap's coastline, which is the other half of #271; a white
    // halo separates the track from whatever it crosses without making it
    // louder. Decision 029: the track is supporting, not the subject.
    //
    // Slate, not the #ffcc33 it was. Once colour carries the taxon, a yellow
    // line is no longer neutral — it sits between the seal and sea-lion
    // oranges, and beside the yellow that means "selected". A track has to be
    // legible without claiming to be one of the categories, so it is the one
    // thing on the map drawn in no hue at all.
    styles.push(new Style({
      stroke: new Stroke({
        color: 'rgba(255, 255, 255, 0.9)',
        width: 4,
      }),
    }));
    styles.push(new Style({
      stroke: new Stroke({
        color: 'rgba(71, 85, 105, 0.85)',
        width: 2,
      }),
    }));
  }
  if (resolution <= TRAVEL_DETAIL_MAX_RESOLUTION) {
    lineString.forEachSegment(function (a, b) {
      const start = a as [number, number];
      const end = b as [number, number];
      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      const rotation = Math.atan2(dy, dx);
      styles.push(
        new Style({
          geometry: new Point([(end[0] + start[0]) / 2, (end[1] + start[1]) / 2]),
          image: new Icon({
            src: travelArrowIcon,
            anchor: [0.75, 0.5],
            rotateWithView: true,
            rotation: -rotation,
          }),
        }),
      );
    });
  }
  const meanTravelSpeed = feature.get('expectedTravelSpeedKmph') as number | undefined;
  if (meanTravelSpeed && resolution <= TRAVEL_DETAIL_MAX_RESOLUTION) {
    const lastCoordinate = lineString.getLastCoordinate();
    const lastOccurrenceAt = feature.get('lastOccurrenceAt') as Date;
    const ageHours = (now().valueOf() - lastOccurrenceAt.valueOf()) / hour_in_ms;
    if (ageHours < 6) {
      for (const delayHours of [ageHours, ageHours + 0.5]) {
        const imputedDistanceM = delayHours * meanTravelSpeed * 1000;
        const opacity = (3 / (3 + 4 * delayHours * ageHours)).toFixed(2);
        const stroke = new Stroke({
          color: `rgba(200, 0, 0, ${opacity})`,
          width: 1,
        });
        styles.push(new Style({
          geometry: new Circle(lastCoordinate, imputedDistanceM, 'XY'),
          stroke,
        }));
        styles.push(new Style({
          geometry: new Point([lastCoordinate[0]!, lastCoordinate[1]! + imputedDistanceM]),
          text: new Text({
            backgroundFill: new Fill({color: transparentWhite}),
            text: ageHours === delayHours ? `now at ${meanTravelSpeed}km/h` : `in 30min`,
          }),
        }));
      }
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

// It's the labels, not the markers, that clutter the map at low zoom: keep
// them behind the old zoom-12 gate while the layer itself (obs-map.ts) now
// shows markers a level earlier. Resolution at integer zoom z in EPSG:3857 is
// 156543.03392804097 / 2^z; "zoom > 12" is "resolution below zoom 12's".
const VIEWING_LABEL_MAX_RESOLUTION = 156543.03392804097 / 2 ** 12;

export const viewingLocationStyle = (location: FeatureLike, resolution: number) => {
  const styles = [
    new Style({
      image: new Icon({src: viewingLocationIcon}),
    }),
  ];
  if (resolution < VIEWING_LABEL_MAX_RESOLUTION) {
    styles.push(new Style({
      text: new Text({
        declutterMode: 'obstacle',
        fill: new Fill({color: black}),
        font: '10px monospace',
        offsetX: 10,
        padding: [1, 1, 0, 1],
        text: location.get('name'),
        textAlign: 'left',
        textBaseline: 'middle',
      }),
    }));
  }
  return styles;
}

export const userLocationStyle = new Style({
  image: new CircleStyle({
    radius: 8,
    fill: new Fill({color: 'rgba(51, 153, 255, 0.8)'}),
    stroke: new Stroke({
      color: '#ffffff',
      width: 2,
    }),
  }),
});

export const hydrophoneStyle = (_hydrophone: FeatureLike) => {
  return new Style({
    image: new Icon({
      src: hydrophoneIcon,
    }),
  })
}

export const salmonCountingSiteStyle = new Style({
  image: new Icon({
    src: salmonCountingSiteIcon,
  }),
});

/**
 * Shading for the map outside the active region.
 *
 * Deliberately a wash rather than a heavy scrim: it has to say "we are not
 * showing you data here" while leaving the coastline legible, because the
 * shaded area is still the map you use to decide where to go next. The border
 * marks where the filter actually cuts — without it the wash has no edge and
 * reads as a rendering artifact rather than a boundary.
 */
export const outsideRegionStyle = new Style({
  fill: new Fill({color: 'rgba(15, 23, 42, 0.14)'}),
  stroke: new Stroke({color: 'rgba(15, 23, 42, 0.45)', width: 1}),
});
