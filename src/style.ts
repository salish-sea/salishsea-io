import type { ExpressionSpecification, LayerSpecification, Map as MapLibreMap } from 'maplibre-gl';
import travelArrowIcon from './assets/travel-arrow.svg?url';
import hydrophoneIcon from './assets/hydrophone-default.svg?url';
import salmonCountingSiteIcon from './assets/salmon-counting-site.svg?url';
import viewingLocationIcon from './assets/viewing-location.svg?url';
import { directionToRads } from './direction.ts';
import type { Occurrence } from './types.ts';
import { GROUPS, labelFor, taxonGroup, trackSummary } from './symbology.ts';

/**
 * What the map draws and how (decision 029, ported to MapLibre by 076).
 *
 * OpenLayers styled each feature with a function run at draw time. MapLibre's
 * layers are declarative, so what those functions decided per feature is
 * decided once, when the feature is made, and stored on it as properties
 * ({@link occurrenceProperties}); the layers below read them back.
 *
 * Zoom levels here are MapLibre's, one lower than the OpenLayers numbers the
 * permalinks still use (see map-view.ts).
 */

const yellow = '#ffff00';
const sans = ['Noto Sans Regular'];
const sansMedium = ['Noto Sans Medium'];

/**
 * `#RRGGBB` at a given alpha. The palette is authored as hex because that is how
 * Okabe–Ito is published; the map needs it translucent.
 */
function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** What an occurrence's dot, label and arrow need, worked out once per feature. */
export type OccurrenceProperties = {
  id: string;
  /** The taxon group's colour, which also names its label box and arrow images. */
  color: string;
  fill: string;
  ring: string;
  /** The segment's head: larger, ringed in white, and labelled. */
  head: boolean;
  label?: string;
  /** Clockwise from east, in degrees, when the report gives a direction of travel. */
  directionDeg?: number;
};

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
export function occurrenceProperties(occurrence: Occurrence): OccurrenceProperties {
  const {direction, isLast, segmentIdentifiers, segmentIdentity, segmentLength, segmentSpanHours} = occurrence;
  const {color} = GROUPS[taxonGroup(occurrence.taxon.scientific_name)];
  const head = !!isLast;
  const properties: OccurrenceProperties = {
    id: occurrence.id,
    color,
    fill: rgba(color, head ? 0.95 : 0.75),
    ring: head ? '#ffffff' : rgba(color, 0.9),
    head,
  };

  if (head) {
    // Pooled over the track, not taken from the head alone: a J-pod encounter
    // reported with the matriline on the first sighting and not the second
    // still names it.
    const identifiers = segmentIdentifiers ?? occurrence.identifiers;
    // segmentIdentity is absent on the drawing layer's in-progress sighting,
    // which belongs to no segment; there the occurrence speaks for itself.
    // An occurrence whose species is only possibly what it says carries the same mark a
    // hedged identifier does (decision 054): "Humpback whale?", never dropped, never plain.
    const hedge = occurrence.certainty === 'possible' ? '?' : '';
    const name = (segmentIdentity ?? labelFor(occurrence)) + hedge;
    const identity = identifiers?.length ? `${name} · ${identifiers.join(', ')}` : name;
    const points = segmentLength ?? 1;
    // One label over one or two lines, so the two lines share a box and are
    // kept or dropped together when labels collide.
    properties.label = points > 1 ? `${identity}\n${trackSummary(points, segmentSpanHours ?? 0)}` : identity;
  }

  if (direction)
    properties.directionDeg = directionToRads(direction) * 180 / Math.PI;
  return properties;
}

const selected: ExpressionSpecification = ['boolean', ['feature-state', 'selected'], false];
const hovered: ExpressionSpecification = ['boolean', ['feature-state', 'hover'], false];

/**
 * An occurrence's dot, its label, and its direction arrow, read from
 * {@link occurrenceProperties}. Used for the day's occurrences and for the
 * sighting being drawn in the form.
 */
function occurrenceLayers(source: string, prefix: string, filter?: ExpressionSpecification): LayerSpecification[] {
  const and = (f: ExpressionSpecification): ExpressionSpecification => filter ? ['all', filter, f] : f;
  return [
    {
      id: `${prefix}-dot`, type: 'circle', source,
      ...(filter ? {filter} : {}),
      paint: {
        // A dot never gives way to a label, since hiding a marker would hide a
        // sighting; circles take no part in MapLibre's collisions at all.
        'circle-radius': ['case', ['get', 'head'], 7, 4.5],
        'circle-color': ['get', 'fill'],
        'circle-stroke-color': ['get', 'ring'],
        'circle-stroke-width': ['case', ['get', 'head'], 2, 1],
        // The selected occurrence is drawn again on top, in the selection's style
        // (see selectedLayers), so it isn't covered by its neighbours.
        'circle-opacity': ['case', selected, 0, 1],
        'circle-stroke-opacity': ['case', selected, 0, 1],
      },
    },
    {
      id: `${prefix}-label`, type: 'symbol', source,
      filter: and(['get', 'head']),
      layout: {
        'text-field': ['get', 'label'],
        'text-font': sansMedium,
        'text-size': 11,
        'text-anchor': 'left',
        'text-justify': 'left',
        'text-offset': [1, 0],
        // OpenLayers broke lines only at \n; MapLibre wraps at 10 ems unless told.
        'text-max-width': 60,
        // Near-opaque. At 88% a marker underneath showed through as a pale
        // smudge, which reads as a rendering fault; a label that lands on a
        // neighbour should look like a label.
        'icon-image': ['concat', 'label-', ['get', 'color']],
        'icon-text-fit': 'both',
        'icon-text-fit-padding': [2, 4, 1, 4],
      },
      paint: {'text-color': '#111827'},
    },
    {
      id: `${prefix}-arrow`, type: 'symbol', source,
      filter: and(['has', 'directionDeg']),
      layout: {
        'icon-image': ['concat', 'arrow-', ['get', 'color']],
        'icon-anchor': 'left',
        'icon-rotate': ['get', 'directionDeg'],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    },
  ];
}

/**
 * Coarser than this, a travel line is drawn but not annotated: no direction
 * arrows, no imputed present position. About 100 m a pixel, where OpenLayers
 * drew them; the old gate was a resolution, `resolution <= 100`.
 *
 * The line itself has no gate. It used to, and the default view of the Salish
 * Sea sits near 500 m/px, so travel lines did not draw at all until you zoomed
 * in ([#271](https://github.com/salish-sea/salishsea-io/issues/271),
 * salish-fll.4).
 *
 * The annotations keep the threshold. They are fixed-size marks on a line whose
 * length shrinks with zoom: at the default view a whole segment is a few dozen
 * pixels, so a midpoint arrow covers the hop it annotates, and the "now at
 * 6.8km/h" circle is a claim about the next half hour that belongs at the zoom
 * where you would act on it.
 */
export const TRAVEL_DETAIL_MIN_ZOOM = Math.log2(156543.03392804097 / 100) - 1;

/**
 * Just past a zoom level. OpenLayers showed a layer only above its minimum zoom;
 * MapLibre shows it at its minimum too, which at the whole-number zooms a
 * permalink opens on would show it a level early.
 */
const past = (zoom: number) => zoom + 0.001;

/**
 * Viewpoint and haul-out names, and haul-out rings, show past this zoom: it's
 * the labels, not the markers, that clutter the map at low zoom.
 */
export const SITE_LABEL_MIN_ZOOM = past(11);

/** Viewpoint markers show from a level earlier than their names. */
export const VIEWPOINT_MIN_ZOOM = past(10);

/**
 * The out-of-region mask shows at this zoom and further out, where the region's
 * edge is in view (GH #16). MapLibre hides a layer at its `maxzoom` and above,
 * so this is a hair past 8 to keep it at 8 itself — zoom 9 in the permalinks.
 */
export const MASK_MAX_ZOOM = 8.001;

/** A haul-out site (decision 040, GH #453): a hollow slate diamond, so it reads as a place and not a sighting. */
export const HAULOUT_COLOR = '#334155';

/** Each reference layer's MapLibre layers, so the layer control can show and hide them together. */
export const REFERENCE_LAYER_IDS = {
  haulouts: ['haulout-ring', 'haulout-marker', 'haulout-label'],
  viewpoints: ['viewpoint-marker', 'viewpoint-label'],
  hydrophones: ['hydrophone'],
  salmon: ['salmon'],
} as const;

const empty = {type: 'FeatureCollection', features: []} as const;

/** The map's sources, all GeoJSON in longitude and latitude, empty until filled. */
export const SOURCES = [
  'mask', 'haulouts', 'haulout-rings', 'viewpoints', 'hydrophones', 'salmon',
  'travel', 'travel-arrows', 'travel-now', 'occurrences', 'selected', 'user-location', 'drawing',
] as const;
export type SourceId = typeof SOURCES[number];

export const ESRI_ATTRIBUTION = 'Base map by Esri and its data providers';

/** The style the map starts with: Esri's ocean basemap and every source, empty. */
export function baseStyle(glyphs: string) {
  return {
    version: 8 as const,
    glyphs,
    sources: {
      'esri-base': {
        type: 'raster' as const,
        tileSize: 256,
        attribution: ESRI_ATTRIBUTION,
        tiles: [
          'https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
          'https://server.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
        ],
      },
      // NB: this source is unmaintained
      'esri-reference': {
        type: 'raster' as const,
        tileSize: 256,
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}'],
      },
      ...Object.fromEntries(SOURCES.map(id => [id, {
        type: 'geojson' as const,
        data: empty,
        // Feature state (selection, hovering) is keyed by the `id` property.
        ...(id === 'occurrences' || id === 'drawing' ? {promoteId: 'id'} : {}),
        ...(id === 'haulouts' ? {attribution: 'Haul-out sites after Jeffries et al. 2000, <i>Atlas of Seal and Sea Lion Haulout Sites in Washington</i>, WDFW.'} : {}),
        ...(id === 'viewpoints' ? {attribution: 'Sighting Viewpoints by Thorsten Lisker and Alisa Lemire Brooks of Orca Network.'} : {}),
      }])),
    },
    layers: LAYERS,
  };
}

const LAYERS: LayerSpecification[] = [
  {id: 'esri-base', type: 'raster', source: 'esri-base'},
  {id: 'esri-reference', type: 'raster', source: 'esri-reference'},

  // Shading for the map outside the active region. Deliberately a wash rather
  // than a heavy scrim: it has to say "we are not showing you data here" while
  // leaving the coastline legible, because the shaded area is still the map you
  // use to decide where to go next. The border marks where the filter actually
  // cuts — without it the wash has no edge and reads as a rendering artifact.
  //
  // Above the basemap, below the occurrences: a sighting that sits just outside
  // the region (a stale ?o= permalink) must stay visible and clickable.
  {id: 'mask-fill', type: 'fill', source: 'mask', maxzoom: MASK_MAX_ZOOM,
    paint: {'fill-color': 'rgba(15, 23, 42, 0.14)'}},
  {id: 'mask-line', type: 'line', source: 'mask', maxzoom: MASK_MAX_ZOOM,
    paint: {'line-color': 'rgba(15, 23, 42, 0.45)', 'line-width': 1}},

  // Infrastructure under the data. These are places that are always there —
  // context for reading the map, not things anybody saw today — and drawing
  // them last let a hydrophone cover a sighting (salish-fll.3).
  //
  // Zoomed in, a haul-out's dashed ring is the radius within which a report
  // counts for the site, drawn as the site's own page draws it.
  {id: 'haulout-ring', type: 'line', source: 'haulout-rings', minzoom: SITE_LABEL_MIN_ZOOM,
    layout: {visibility: 'none'},
    paint: {'line-color': rgba(HAULOUT_COLOR, 0.7), 'line-width': 1.25, 'line-dasharray': [3.2, 3.2]}},
  // A report on the site must stay visible, so the marker never hides one.
  {id: 'haulout-marker', type: 'symbol', source: 'haulouts',
    layout: {visibility: 'none', 'icon-image': 'haulout', 'icon-allow-overlap': true}},
  // The names give way to one another: the atlas maps some sites at several
  // points a few hundred metres apart, all under one name.
  {id: 'haulout-label', type: 'symbol', source: 'haulouts', minzoom: SITE_LABEL_MIN_ZOOM,
    layout: {visibility: 'none', 'text-field': ['get', 'name'], 'text-font': sans, 'text-size': 10,
      'text-anchor': 'left', 'text-offset': [1, 0], 'text-max-width': 60},
    paint: {'text-color': HAULOUT_COLOR}},
  {id: 'viewpoint-marker', type: 'symbol', source: 'viewpoints', minzoom: VIEWPOINT_MIN_ZOOM,
    layout: {'icon-image': 'viewpoint', 'icon-allow-overlap': true}},
  // These names give way to the occurrences' labels, which MapLibre places first
  // because they are drawn above.
  {id: 'viewpoint-label', type: 'symbol', source: 'viewpoints', minzoom: SITE_LABEL_MIN_ZOOM,
    layout: {'text-field': ['get', 'name'], 'text-font': sans, 'text-size': 10,
      'text-anchor': 'left', 'text-offset': [1, 0], 'text-max-width': 60},
    paint: {'text-color': '#000000'}},
  {id: 'hydrophone', type: 'symbol', source: 'hydrophones',
    layout: {'icon-image': 'hydrophone', 'icon-allow-overlap': true}},
  {id: 'salmon', type: 'symbol', source: 'salmon',
    layout: {'icon-image': 'salmon', 'icon-allow-overlap': true}},

  // A casing under the line, not a heavier line. 2px alone disappears into the
  // Esri basemap's coastline, which is the other half of #271; a white halo
  // separates the track from whatever it crosses without making it louder.
  // Decision 029: the track is supporting, not the subject.
  //
  // Slate: once colour carries the taxon, a coloured line is no longer neutral.
  // A track has to be legible without claiming to be one of the categories, so
  // it is the one thing on the map drawn in no hue at all.
  {id: 'travel-casing', type: 'line', source: 'travel',
    paint: {'line-color': 'rgba(255, 255, 255, 0.9)', 'line-width': 4}},
  {id: 'travel-line', type: 'line', source: 'travel',
    paint: {'line-color': 'rgba(71, 85, 105, 0.85)', 'line-width': 2}},
  {id: 'travel-arrow', type: 'symbol', source: 'travel-arrows', minzoom: TRAVEL_DETAIL_MIN_ZOOM,
    layout: {'icon-image': 'travel-arrow', 'icon-rotate': ['get', 'rotation'], 'icon-rotation-alignment': 'map',
      // The arrow's tip sits three quarters of the way along it, on the hop's midpoint.
      'icon-offset': [-4.5, 0],
      'icon-allow-overlap': true, 'icon-ignore-placement': true}},
  {id: 'travel-now-ring', type: 'line', source: 'travel-now', minzoom: TRAVEL_DETAIL_MIN_ZOOM,
    filter: ['==', ['geometry-type'], 'LineString'],
    paint: {'line-color': 'rgb(200, 0, 0)', 'line-opacity': ['get', 'opacity'], 'line-width': 1}},
  {id: 'travel-now-label', type: 'symbol', source: 'travel-now', minzoom: TRAVEL_DETAIL_MIN_ZOOM,
    filter: ['==', ['geometry-type'], 'Point'],
    layout: {'text-field': ['get', 'label'], 'text-font': sans, 'text-size': 10,
      'icon-image': 'now-label', 'icon-text-fit': 'both',
      'text-allow-overlap': true, 'icon-allow-overlap': true}},

  ...occurrenceLayers('occurrences', 'occurrence'),

  // The selected occurrence, drawn over everything else so it is never hidden.
  {id: 'selected-dot', type: 'circle', source: 'selected',
    paint: {'circle-radius': 9, 'circle-color': 'rgba(255, 255, 0, 0.5)',
      'circle-stroke-color': yellow, 'circle-stroke-width': 3}},

  {id: 'user-location', type: 'circle', source: 'user-location',
    paint: {'circle-radius': 8, 'circle-color': 'rgba(51, 153, 255, 0.8)',
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2}},

  // The sighting being drawn in the form: the bearing from observer to subject,
  // dashed blue with "x km at y°" at its middle.
  {id: 'bearing', type: 'line', source: 'drawing', filter: ['==', ['get', 'kind'], 'Bearing'],
    paint: {'line-color': '#0000ff', 'line-width': 1.5, 'line-dasharray': [2, 4]}},
  {id: 'bearing-label', type: 'symbol', source: 'drawing', filter: ['==', ['get', 'kind'], 'Bearing'],
    layout: {'symbol-placement': 'line-center', 'text-rotation-alignment': 'viewport', 'icon-rotation-alignment': 'viewport',
      'text-field': ['get', 'label'], 'text-font': sans, 'text-size': 10,
      'icon-image': 'bearing-label', 'icon-text-fit': 'both',
      'text-allow-overlap': true, 'icon-allow-overlap': true}},
  ...occurrenceLayers('drawing', 'draft', ['==', ['get', 'kind'], 'Sighting']),
  // The draft's points take a yellow ring while the pointer is close enough to grab them.
  {id: 'draft-halo', type: 'circle', source: 'drawing',
    filter: ['in', ['get', 'kind'], ['literal', ['Sighter', 'Sighting']]],
    paint: {'circle-radius': 11, 'circle-color': 'rgba(255, 255, 0, 0.5)', 'circle-stroke-color': yellow,
      'circle-stroke-width': 3, 'circle-opacity': ['case', hovered, 1, 0], 'circle-stroke-opacity': ['case', hovered, 1, 0]}},
  {id: 'sighter', type: 'symbol', source: 'drawing', filter: ['==', ['get', 'kind'], 'Sighter'],
    layout: {'icon-image': 'sighter', 'icon-allow-overlap': true, 'icon-ignore-placement': true}},
];

/** The layers whose features a click on the map can select. */
export const OCCURRENCE_LAYERS = ['occurrence-dot', 'occurrence-label'];
/** The reference layers whose features a click opens. */
export const CLICKABLE_REFERENCE_LAYERS = ['hydrophone', 'salmon', 'haulout-marker'];

// Images.
//
// MapLibre draws text from prebuilt glyphs, which have no emoji and no arrows,
// and fills a label's box with a stretched image rather than a background
// colour. Everything that isn't plain text or a circle is therefore an image,
// drawn here once with the browser's own canvas, so emoji and arrows come out as
// the browser draws them.

const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 3);

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const ratio = pixelRatio();
  const element = document.createElement('canvas');
  element.width = Math.ceil(width * ratio);
  element.height = Math.ceil(height * ratio);
  const context = element.getContext('2d')!;
  context.scale(ratio, ratio);
  return [element, context];
}

const pixels = (element: HTMLCanvasElement) =>
  element.getContext('2d')!.getImageData(0, 0, element.width, element.height);

/** Text drawn by the browser, its left edge at the image's left edge and centred vertically. */
function glyph(text: string, font: string, color = '#000000') {
  const [, probe] = canvas(1, 1);
  probe.font = font;
  const metrics = probe.measureText(text);
  const width = Math.ceil(metrics.width) + 2;
  const height = Math.ceil(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) + 4;
  const [element, context] = canvas(width, height);
  context.font = font;
  context.fillStyle = color;
  context.textBaseline = 'alphabetic';
  context.fillText(text, 1, 2 + metrics.actualBoundingBoxAscent);
  return pixels(element);
}

/** A 16px box with a 1px border, stretchable between its corners, for `icon-text-fit`. */
function box(fill: string, stroke?: string) {
  const [element, context] = canvas(16, 16);
  context.fillStyle = fill;
  context.fillRect(0, 0, 16, 16);
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = 1;
    context.strokeRect(0.5, 0.5, 15, 15);
  }
  const s = (x: number) => x * pixelRatio();
  return [pixels(element), {
    pixelRatio: pixelRatio(),
    stretchX: [[s(2), s(14)]] as [number, number][],
    stretchY: [[s(2), s(14)]] as [number, number][],
    content: [s(2), s(2), s(14), s(14)] as [number, number, number, number],
  }] as const;
}

/** The haul-out diamond: a square on its point, white inside, slate edge. */
function diamond() {
  const [element, context] = canvas(16, 16);
  context.beginPath();
  context.moveTo(8, 2); context.lineTo(14, 8); context.lineTo(8, 14); context.lineTo(2, 8);
  context.closePath();
  context.fillStyle = 'rgba(255, 255, 255, 0.85)';
  context.fill();
  context.strokeStyle = HAULOUT_COLOR;
  context.lineWidth = 2;
  context.stroke();
  return pixels(element);
}

/** An SVG drawn at its own size, sharp at the screen's pixel density. */
async function svgImage(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const [element, context] = canvas(image.width, image.height);
  context.drawImage(image, 0, 0, image.width, image.height);
  return pixels(element);
}

/** Add every image the layers name. The SVG icons arrive a moment after the rest. */
export async function addImages(map: MapLibreMap): Promise<void> {
  const ratio = pixelRatio();
  for (const {color} of Object.values(GROUPS)) {
    map.addImage(`arrow-${color}`, glyph(' ⇢', '15px monospace', color), {pixelRatio: ratio});
    map.addImage(`label-${color}`, ...box('rgba(255, 255, 255, 0.96)', rgba(color, 0.5)));
  }
  map.addImage('bearing-label', ...box('rgba(240, 240, 240, 0.85)'));
  map.addImage('now-label', ...box('rgba(255, 255, 255, 0.4)'));
  map.addImage('sighter', glyph('👁️‍🗨️', '10px sans-serif'), {pixelRatio: ratio});
  map.addImage('haulout', diamond(), {pixelRatio: ratio});
  const icons = {
    'travel-arrow': travelArrowIcon,
    hydrophone: hydrophoneIcon,
    salmon: salmonCountingSiteIcon,
    viewpoint: viewingLocationIcon,
  };
  await Promise.all(Object.entries(icons).map(async ([id, url]) =>
    map.addImage(id, await svgImage(url), {pixelRatio: ratio})));
}
