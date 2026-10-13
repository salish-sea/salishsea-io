import { LitElement, css, html } from 'lit'
import type { PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js'
import { AttributionControl, Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import type { GeoJSONSource, LngLatBoundsLike, MapGeoJSONFeature, MapMouseEvent, PointLike } from 'maplibre-gl';
import maplibreCSS from 'maplibre-gl/dist/maplibre-gl.css?url';
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Feature, FeatureCollection, LineString } from 'geojson';
import { circle } from '@turf/circle';
import { Temporal } from 'temporal-polyfill';
import './obs-panel.ts';
import './obs-summary.ts';

import { addImages, baseStyle, CLICKABLE_REFERENCE_LAYERS, OCCURRENCE_LAYERS, occurrenceProperties, REFERENCE_LAYER_IDS, type SourceId } from './style.ts';
import type { Occurrence } from './types.ts';
import { imputedPositions, occurrences2segments, placeInSegment, segment2travelLine, travelArrows, type TravelLineProperties } from './segments.ts';
import { createRef, ref } from 'lit/directives/ref.js';
import { compactMap } from './utils.ts';
import type { Extent } from './constants.ts';
import UserLocationControl from './user-location-control.ts';
import LayerControl from './layer-control.ts';
import { DEFAULT_LAYERS, type ReferenceLayer } from './reference-layers.ts';
import { hauloutPath, type HauloutSite } from './catalog.ts';
import { fetchStaticHauloutSites } from './read-path.ts';
import { reportError } from './report-error.ts';
import { geolocationErrorIsReportable } from './geolocation-message.ts';
import { fromLonLat, mapZoom, permalinkZoom, toLonLat } from './map-view.ts';
import { SightingDrafts } from './sighting-drafts.ts';

setWorkerUrl(maplibreWorker);

export type LayersChangeDetail = Set<ReferenceLayer>;

/** The map's position as permalinks carry it: EPSG:3857 metres and OpenLayers' zoom (see map-view.ts). */
export type MapMoveDetail = {
  center: [number, number];
  zoom: number;
}

const emptyCollection = (): FeatureCollection => ({type: 'FeatureCollection', features: []});

// The clock the imputed positions are measured against: now, or the time a
// `?d=…&t=…` link asks for, so a past day can be seen as it looked then.
let nowOverride: number | null = null;
(() => {
  const params = new URLSearchParams(document.location.search);
  const d = params.get('d');
  const t = params.get('t');
  if (d && t) {
    try {
      nowOverride = Temporal.PlainDate.from(d).toZonedDateTime({timeZone: 'PST8PDT', plainTime: t}).epochMilliseconds;
    } catch (e) {
      console.error(e);
    }
  }
})();
const now = () => nowOverride ?? Date.now();

/** A square of `tolerance` pixels each way around a point, for hit-testing. */
const around = ({x, y}: {x: number, y: number}, tolerance: number): [PointLike, PointLike] =>
  [[x - tolerance, y - tolerance], [x + tolerance, y + tolerance]];

// A thin wrapper around imperative code driving MapLibre GL (decision 076).
@customElement('obs-map')
export class ObsMap extends LitElement {
  /** The sightings open forms are drawing. Exists before the map does, so a form can start one at any time. */
  public readonly drafts = new SightingDrafts();

  #map: MapLibreMap | undefined;
  #loaded = false;
  /** What each source should hold. Kept so data set before the map has loaded is drawn once it has. */
  readonly #data = new Map<SourceId, FeatureCollection>();
  /** The day's occurrences by id, as placed in their segments: what a click on a dot hands on. */
  #occurrences = new Map<string, Occurrence>();
  #travelLines: Feature<LineString, TravelLineProperties>[] = [];
  #selectedId: string | null = null;
  #hauloutsLoaded: Promise<void> | null = null;
  /** A frame asked for before the map existed or had a size. */
  #pendingFrame: Extent | null = null;
  #clock: ReturnType<typeof setInterval> | undefined;

  /** Which reference layers are drawn (GH #453). A change made with the map's own control is dispatched as `layers-change`. */
  @property({attribute: false})
  public visibleLayers: ReadonlySet<ReferenceLayer> = DEFAULT_LAYERS;

  private layerControl = new LayerControl({
    visible: this.visibleLayers,
    onChange: (detail: LayersChangeDetail) =>
      this.dispatchEvent(new CustomEvent('layers-change', {bubbles: true, composed: true, detail})),
  });

  @property({type: String, reflect: true})
  public focusedOccurrenceId: string | undefined

  /**
   * Lon/lat bounds of the active region, or `null` for "Everywhere".
   *
   * Everything outside is shaded. The point is GH #16: without it, panning past
   * the filter shows empty water that reads as "no whales were seen here" when
   * it means "we are not showing you this". The mask says which. It shows at
   * zoom 9 and further out, where the region's edge is in view; zoomed in past
   * that, you are looking inside the region, and it would only grey the margins.
   */
  @property({attribute: false})
  public maskExtent: Extent | null = null;

  /** The starting centre, in EPSG:3857 metres, as the permalink gives it. */
  @property({type: Number, reflect: true})
  private centerX!: number

  @property({type: Number, reflect: true})
  private centerY!: number

  /** The starting zoom, in OpenLayers' numbering, as the permalink gives it. */
  @property({type: Number, reflect: true})
  private zoom!: number

  mapRef = createRef<HTMLDivElement>();

  static styles = css`
:host {
  align-items: stretch;
  display: flex;
  flex-direction: row;
  flex-grow: 1;
  overflow: hidden;
}
#map {
  flex-grow: 1;
}
user-location-control, layer-control {
  display: block;
}
user-location-control svg, layer-control svg.inline-icon {
  fill: currentColor;
  height: 18px;
  vertical-align: middle;
  width: 18px;
}
layer-control {
  position: relative;
}
layer-control .layer-menu {
  background: white;
  border: 1px solid rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  margin: 0.3em 0 0;
  padding: 0.4em 0.6em 0.5em;
  position: absolute;
  right: 0;
  top: 100%;
  white-space: nowrap;
}
layer-control legend {
  float: left;
  font-size: 0.8rem;
  font-weight: 600;
  padding: 0 0 0.2em;
  width: 100%;
}
layer-control label {
  align-items: center;
  clear: both;
  cursor: pointer;
  display: flex;
  font-size: 0.85rem;
  gap: 0.4em;
  padding: 0.2em 0;
}
layer-control .marker {
  display: inline-flex;
  height: 16px;
  justify-content: center;
  width: 16px;
}
layer-control .marker img, layer-control .marker svg {
  max-height: 16px;
  max-width: 16px;
}
user-location-control.active svg { color: rgb(51, 153, 255); }
user-location-control.error svg { color: red; }
user-location-control.inactive svg { color: #333; }
@media (pointer: coarse) {
  layer-control label {
    font-size: 1rem;
    padding: 0.45em 0;
  }
}
  `

  public render() {
    return html`
      <link rel="stylesheet" href="${maplibreCSS}" type="text/css" />
      <div ${ref(this.mapRef)} id="map"></div>
    `;
  }

  public firstUpdated(_changedProperties: PropertyValues): void {
    const frame = this.#pendingFrame;
    this.#pendingFrame = null;
    let map: MapLibreMap;
    try {
      map = this.#map = this.#createMap();
    } catch (err) {
      // MapLibre needs WebGL2; without it the rest of the page still works.
      reportError(this, "This browser can't draw the map. The list of sightings still works.", {cause: err, capture: false});
      return;
    }

    // A region asked for before the map existed, framed once it has a size.
    if (frame)
      this.frameExtentWhenReady(frame);
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();
    map.addControl(new NavigationControl({showCompass: false}), 'top-left');
    if ('geolocation' in navigator)
      map.addControl(new UserLocationControl({
        onLocationUpdated: this.onLocationUpdated.bind(this),
        onLocationInactive: this.onLocationInactive.bind(this),
        onLocationError: (message, error) =>
          reportError(this, message, {cause: error, capture: geolocationErrorIsReportable(error)}),
      }), 'top-left');
    map.addControl(this.layerControl, 'top-right');
    map.addControl(new AttributionControl({compact: true}), 'bottom-right');
    // Folded behind its button from the start, as OpenLayers' was. MapLibre opens
    // it on a wide map; its own button closes it, keeping its ARIA state right.
    map.once('load', () => {
      if (map.getContainer().querySelector('.maplibregl-compact-show'))
        map.getContainer().querySelector<HTMLButtonElement>('.maplibregl-ctrl-attrib-button')?.click();
    });

    map.on('load', () => {
      this.#loaded = true;
      addImages(map).catch(err => console.error('Failed to load map icons:', err));
      for (const [id, data] of this.#data)
        map.getSource<GeoJSONSource>(id)!.setData(data);
      this.#applyVisibility();
      this.#select(this.#selectedId);
      this.drafts.attach(map);
      // OpenLayers announced the first view as a move, which is what first
      // writes a position into the URL; keep that.
      this.onMoveEnd();
    });
    map.on('click', this.onClick.bind(this));
    map.on('mousemove', this.onPointerMove.bind(this));
    map.on('moveend', this.onMoveEnd.bind(this));

    // The arrows' imputed positions say where the animals are now, so they move on with the clock.
    this.#clock = setInterval(() => this.#drawImputedPositions(), 60_000);

    // Load GeoJSON layers asynchronously
    this.loadReferenceLayer('viewpoints', () => import('./assets/orcanetwork-viewing-locations.geojson?raw'));
    this.loadReferenceLayer('hydrophones', () => import('./assets/orcasound-hydrophones.geojson?raw'));
    this.loadReferenceLayer('salmon', () => import('./assets/orcasalmon-counting-sites.geojson?raw'));
  }

  #createMap(): MapLibreMap {
    return new MapLibreMap({
      container: this.mapRef.value!,
      // Absolute, and not built with URL(), which would escape the braces MapLibre fills in.
      style: baseStyle(`${location.origin}${import.meta.env.BASE_URL}glyphs/{fontstack}/{range}.pbf`),
      center: toLonLat([this.centerX, this.centerY]),
      zoom: mapZoom(this.zoom),
      attributionControl: false,
      // A north-up map, as it has always been: nothing here reads a rotation.
      dragRotate: false,
      pitchWithRotate: false,
      maxPitch: 0,
      // No fading labels in and out: every move of a point being dragged
      // redraws the drawing layer, and would fade its label again each time.
      fadeDuration: 0,
    });
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this.#clock);
    this.drafts.detach();
  }

  #setData(id: SourceId, data: FeatureCollection) {
    this.#data.set(id, data);
    if (this.#loaded)
      this.#map!.getSource<GeoJSONSource>(id)!.setData(data);
  }

  protected onClick(evt: MapMouseEvent) {
    if (this.drafts.takeClick())
      return;
    // The topmost feature only: a sighting drawn over a site is the sighting's
    // click, and a site under a sighting is not opened by it.
    const [top] = this.#map!.queryRenderedFeatures(around(evt.point, 2), {
      layers: [...OCCURRENCE_LAYERS, ...CLICKABLE_REFERENCE_LAYERS],
    });
    const occurrence = top && OCCURRENCE_LAYERS.includes(top.layer.id)
      ? this.#occurrences.get(top.properties['id'])
      : undefined;
    if (occurrence) {
      if (occurrence.id !== this.#selectedId) {
        this.#select(occurrence.id);
        this.dispatchEvent(new CustomEvent('focus-occurrence', {bubbles: true, composed: true, detail: occurrence}));
      }
      return;
    }
    if (this.#selectedId) {
      this.#select(null);
      this.dispatchEvent(new CustomEvent('focus-occurrence', {bubbles: true, composed: true, detail: null}));
    }
    const kind = top?.properties['kind'];
    if (kind === 'Hydrophone' || kind === 'SalmonCountingSite')
      window.open(top!.properties['url'], '_blank');
    // Our own page, so the same tab: the map's state, this layer included, is
    // in the URL, and Back returns to it.
    else if (kind === 'Haulout')
      window.location.assign(hauloutPath({id: top!.properties['id'], name: top!.properties['name']}));
  }

  #featureAt(point: {x: number, y: number}): MapGeoJSONFeature | undefined {
    return this.#map!.queryRenderedFeatures(around(point, 2), {
      layers: [...OCCURRENCE_LAYERS, ...CLICKABLE_REFERENCE_LAYERS],
    })[0];
  }

  // A site's name at any zoom, since its label shows only from zoom 12, and a
  // hand where a click goes somewhere.
  protected onPointerMove(evt: MapMouseEvent) {
    const target = this.mapRef.value;
    if (!target || this.drafts.busy || this.drafts.hovering || evt.originalEvent.buttons)
      return;
    const feature = this.#featureAt(evt.point);
    this.#map!.getCanvas().style.cursor = feature ? 'pointer' : '';
    target.title = CLICKABLE_REFERENCE_LAYERS.includes(feature?.layer.id ?? '') ? feature!.properties['name'] ?? '' : '';
  }

  private skipNextMoveEvent = false;

  protected onMoveEnd() {
    if (this.skipNextMoveEvent) {
      this.skipNextMoveEvent = false;
      return;
    }
    const {lng, lat} = this.#map!.getCenter();
    const detail: MapMoveDetail = {
      center: fromLonLat([lng, lat]),
      zoom: permalinkZoom(this.#map!.getZoom()),
    };
    this.dispatchEvent(new CustomEvent('map-move', {bubbles: true, composed: true, detail}));
  }

  /**
   * Programmatically set the map view (center and zoom)
   * @param x - X coordinate in EPSG:3857, as permalinks carry it
   * @param y - Y coordinate in EPSG:3857
   * @param zoom - Zoom level, in OpenLayers' numbering, as permalinks carry it
   * @param options - Optional configuration
   * @param options.skipEvent - If true, suppresses the 'map-move' event
   */
  public setView(x: number, y: number, zoom: number, options: {skipEvent?: boolean} = {}) {
    if (!this.#map) {
      this.centerX = x;
      this.centerY = y;
      this.zoom = zoom;
      return;
    }
    if (options.skipEvent)
      this.skipNextMoveEvent = true;
    this.#map.jumpTo({center: toLonLat([x, y]), zoom: mapZoom(zoom)});
  }

  private async loadReferenceLayer(id: 'viewpoints' | 'hydrophones' | 'salmon', load: () => Promise<{default: string}>) {
    try {
      const {default: geojsonText} = await load();
      this.#setData(id, JSON.parse(geojsonText) as FeatureCollection);
    } catch (err) {
      console.error(`Failed to load ${id}:`, err);
    }
  }

  // Loaded the first time it is switched on (decision 058): hidden by default,
  // so most visits never ask for it.
  private loadHaulouts() {
    this.#hauloutsLoaded ??= fetchStaticHauloutSites()
      .then(sites => {
        const located = sites.filter(({location}) => location.lon !== null && location.lat !== null);
        this.#setData('haulouts', {type: 'FeatureCollection', features: located.map(hauloutFeature)});
        // A polygon around each site, not a MapLibre circle, which is sized in
        // pixels: the ring is the site's radius on the water.
        this.#setData('haulout-rings', {type: 'FeatureCollection', features: located.map(({location, radius_m}) =>
          circle([location.lon!, location.lat!], radius_m / 1000, {steps: 64, units: 'kilometers'}))});
      })
      .catch(err => {
        // Not latched, so switching the layer off and on again retries.
        this.#hauloutsLoaded = null;
        reportError(this, "Couldn't load the haul-out sites.", {cause: err});
      });
  }

  public setOccurrences(occurrences: Occurrence[]) {
    const segments = occurrences2segments(occurrences);
    const placed = segments.flatMap(placeInSegment);
    this.#occurrences = new Map(placed.map(occurrence => [occurrence.id, occurrence]));
    this.#setData('occurrences', {type: 'FeatureCollection', features: compactMap(placed, occurrenceFeature)});

    this.#travelLines = compactMap(segments, segment2travelLine);
    this.#setData('travel', {type: 'FeatureCollection', features: this.#travelLines});
    this.#setData('travel-arrows', {type: 'FeatureCollection', features: this.#travelLines.flatMap(travelArrows)});
    this.#drawImputedPositions();

    // Select the focused occurrence if one is set; otherwise drop a selection
    // whose occurrence is no longer on the map.
    const keep = this.focusedOccurrenceId ?? this.#selectedId;
    this.#select(keep && this.#occurrences.has(keep) ? keep : null);
  }

  #drawImputedPositions() {
    const time = now();
    this.#setData('travel-now', {type: 'FeatureCollection', features: this.#travelLines.flatMap(line => imputedPositions(line, time))});
  }

  /** Mark an occurrence selected, drawing it again on top in the selection's style; `null` clears it. */
  #select(id: string | null) {
    if (this.#loaded && this.#selectedId && this.#selectedId !== id)
      this.#map!.setFeatureState({source: 'occurrences', id: this.#selectedId}, {selected: false});
    this.#selectedId = id;
    const occurrence = id ? this.#occurrences.get(id) : undefined;
    const feature = occurrence && occurrenceFeature(occurrence);
    this.#setData('selected', {type: 'FeatureCollection', features: feature ? [feature] : []});
    if (this.#loaded && id)
      this.#map!.setFeatureState({source: 'occurrences', id}, {selected: true});
  }

  #applyVisibility() {
    if (!this.#loaded) return;
    for (const [layer, ids] of Object.entries(REFERENCE_LAYER_IDS))
      for (const id of ids)
        this.#map!.setLayoutProperty(id, 'visibility', this.visibleLayers.has(layer as ReferenceLayer) ? 'visible' : 'none');
  }

  protected willUpdate(changedProperties: PropertyValues): void {
    if (changedProperties.has('visibleLayers')) {
      this.#applyVisibility();
      this.layerControl.visible = this.visibleLayers;
      if (this.visibleLayers.has('haulouts'))
        this.loadHaulouts();
    }
    if (changedProperties.has('maskExtent'))
      this.#setData('mask', this.maskExtent ? maskCollection(this.maskExtent) : emptyCollection());
    if (changedProperties.has('focusedOccurrenceId') && this.focusedOccurrenceId) {
      const occurrence = this.#occurrences.get(this.focusedOccurrenceId);
      if (occurrence) {
        this.#select(occurrence.id);
        this.ensureInViewport([occurrence.location.lon, occurrence.location.lat]);
      }
    }
  }

  /** Bring a point into view, zooming in to zoom 12 (in the permalinks' numbering) to show it, if it is off screen. */
  public ensureInViewport(lonLat: [number, number]) {
    const map = this.#map;
    if (!map || map.getBounds().contains(lonLat))
      return;
    map.easeTo({center: lonLat, zoom: mapZoom(12)});
  }

  public zoomToExtent(extent: Extent) {
    if (!this.#map) {
      this.#pendingFrame = extent;
      return;
    }
    this.#map.fitBounds(bounds(extent), {animate: false});
  }

  /**
   * Like {@link zoomToExtent}, but safe to call before the map is on screen:
   * before it exists, the frame waits for it; before its element has
   * been laid out, the frame waits for the first size, since fitting to a
   * viewport of no size fits nothing.
   */
  public frameExtentWhenReady(extent: Extent) {
    const map = this.#map;
    if (!map) {
      this.#pendingFrame = extent;
      return;
    }
    const container = map.getContainer();
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      this.zoomToExtent(extent);
      return;
    }
    const onResize = () => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      map.off('resize', onResize);
      this.zoomToExtent(extent);
    };
    map.on('resize', onResize);
  }

  #userLocationShown = false;

  public onLocationUpdated({longitude, latitude}: {longitude: number; latitude: number}) {
    if (!this.#userLocationShown)
      this.ensureInViewport([longitude, latitude]);
    this.#userLocationShown = true;
    this.#setData('user-location', {type: 'FeatureCollection', features: [
      {type: 'Feature', geometry: {type: 'Point', coordinates: [longitude, latitude]}, properties: {}},
    ]});
  }

  public onLocationInactive() {
    this.#userLocationShown = false;
    this.#setData('user-location', emptyCollection());
  }
}

const bounds = ([west, south, east, north]: Extent): LngLatBoundsLike => [[west, south], [east, north]];

function occurrenceFeature(occurrence: Occurrence): Feature | undefined {
  const {lat, lon} = occurrence.location;
  if (lon == null || lat == null) {
    console.error(`Occurrence ${occurrence.id} missing location: ${JSON.stringify(occurrence.location)}`);
    return undefined;
  }
  return {type: 'Feature', geometry: {type: 'Point', coordinates: [lon, lat]}, properties: occurrenceProperties(occurrence)};
}

function hauloutFeature({id, name, location}: HauloutSite): Feature {
  return {
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [location.lon!, location.lat!]},
    properties: {kind: 'Haulout', id, name},
  };
}

/**
 * Shade the world outside the active region: one polygon covering everything,
 * with the region punched out as a hole.
 */
export function maskCollection([minLon, minLat, maxLon, maxLat]: Extent): FeatureCollection {
  // ±85 rather than ±90: the Mercator projection is undefined at the poles.
  const outer = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  // Wound opposite to the outer ring, per the GeoJSON convention for holes.
  const hole = [[minLon, minLat], [minLon, maxLat], [maxLon, maxLat], [maxLon, minLat], [minLon, minLat]];
  return {type: 'FeatureCollection', features: [
    {type: 'Feature', geometry: {type: 'Polygon', coordinates: [outer, hole]}, properties: {}},
  ]};
}

declare global {
  interface HTMLElementTagNameMap {
    "obs-map": ObsMap;
  }
}
