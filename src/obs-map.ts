import { LitElement, css, html, nothing } from 'lit'
import type { PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js'
import { addProtocol, AttributionControl, GPUInitializationError, Map as MapLibreMap, NavigationControl, setWorkerUrl } from 'maplibre-gl';
import { Protocol } from 'pmtiles';
import type { GeoJSONSource, LngLatBoundsLike, MapGeoJSONFeature, MapMouseEvent, PointLike } from 'maplibre-gl';
import maplibreCSS from 'maplibre-gl/dist/maplibre-gl.css?url';
import maplibreWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Feature, FeatureCollection, LineString } from 'geojson';
import { circle } from '@turf/circle';
import { Temporal } from 'temporal-polyfill';
import './obs-panel.ts';
import './obs-summary.ts';

import { addImages, BASEMAP_BOUNDS, BASEMAP_MIN_ZOOM, baseStyle, CLICKABLE_REFERENCE_LAYERS, OCCURRENCE_LAYERS, occurrenceProperties, REFERENCE_LAYER_IDS, REGION_FILL, ringColours, SUBJECT_LAYERS, uncertaintyRadius, type SourceId } from './style.ts';
import type { Occurrence } from './types.ts';
import { imputedPositions, occurrences2segments, placeInSegment, segment2travelLine, travelArrows, type TravelLineProperties } from './segments.ts';
import { createRef, ref } from 'lit/directives/ref.js';
import { compactMap } from './utils.ts';
import type { Extent } from './constants.ts';
import UserLocationControl from './user-location-control.ts';
import LayerControl from './layer-control.ts';
import { DEFAULT_LAYERS, REFERENCE_LAYERS, type ReferenceLayer } from './reference-layers.ts';
import { hauloutPath, observedDate, type HauloutSite } from './catalog.ts';
import { formatDate } from './date-format.ts';
import { fetchStaticHauloutSites } from './read-path.ts';
import { reportError } from './report-error.ts';
import { geolocationErrorIsReportable } from './geolocation-message.ts';
import { fromLonLat, mapZoom, permalinkZoom, toLonLat } from './map-view.ts';
import { SightingDrafts } from './sighting-drafts.ts';

setWorkerUrl(maplibreWorker);
// The basemap's tiles are read from PMTiles archives on tiles.salishsea.io.
addProtocol('pmtiles', new Protocol().tile);

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
      nowOverride = Temporal.PlainDate.from(d).toZonedDateTime({timeZone: 'America/Los_Angeles', plainTime: t}).epochMilliseconds;
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
  /** This browser can't make a map; put back on the page, it doesn't try (or report) again. */
  #cannotDraw = false;
  /** Stops waiting for a size to frame a region in, handing the region back for the next map. */
  #stopWaitingToFrame: (() => void) | null = null;

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
  position: relative;
}
/* The water region under the pointer, or tapped, while the regions are shown: the name a
   sighting there would be given (the basemap's decision 027). */
.region-name {
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: var(--shadow-float);
  font-size: var(--fs-body2);
  font-weight: 400;
  left: 0.5rem;
  max-width: calc(100% - 4rem);
  padding: 0.25rem 0.5rem;
  pointer-events: none;
  position: absolute;
  top: 0.5rem;
  z-index: 2;
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
  border: 1px solid var(--color-border);
  border-radius: 4px;
  box-shadow: var(--shadow-popover);
  margin: 0.3em 0 0;
  padding: 0.4em 0.6em 0.5em;
  position: absolute;
  right: 0;
  top: 100%;
  white-space: nowrap;
}
layer-control legend {
  float: left;
  font-size: var(--fs-caption);
  font-weight: 400;
  padding: 0 0 0.2em;
  width: 100%;
}
layer-control label {
  align-items: center;
  clear: both;
  cursor: pointer;
  display: flex;
  font-size: var(--fs-body2);
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
user-location-control.active svg { color: var(--color-primary); }
user-location-control.error svg { color: var(--color-error); }
user-location-control.inactive svg { color: var(--color-text); }
@media (pointer: coarse) {
  layer-control label {
    font-size: var(--fs-body1);
    padding: 0.45em 0;
  }
}
  `

  public render() {
    return html`
      <link rel="stylesheet" href="${maplibreCSS}" type="text/css" />
      <div ${ref(this.mapRef)} id="map"></div>
      ${this.regionName ? html`<div class="region-name" role="status">${this.regionName}</div>` : nothing}
    `;
  }

  public firstUpdated(_changedProperties: PropertyValues): void {
    // Removed before its first render finished, it waits to be put back.
    if (this.isConnected)
      this.#build();
    // Load GeoJSON layers asynchronously
    this.loadReferenceLayer('viewpoints', () => import('./assets/orcanetwork-viewing-locations.geojson?raw'));
    this.loadReferenceLayer('hydrophones', () => import('./assets/orcasound-hydrophones.geojson?raw'));
    this.loadReferenceLayer('salmon', () => import('./assets/orcasalmon-counting-sites.geojson?raw'));
  }

  /** Make the map, with everything already set on the element drawn once it has loaded. */
  #build() {
    const frame = this.#pendingFrame;
    this.#pendingFrame = null;
    let map: MapLibreMap;
    try {
      map = this.#map = this.#createMap();
    } catch (err) {
      // MapLibre needs WebGL2; without it the rest of the page still works. The
      // browser is no fault of ours, but how many visitors it leaves without a map
      // is worth knowing (OpenLayers drew on a plain canvas, which every browser
      // has), so it goes to Sentry as one issue, ignored until it escalates.
      this.#cannotDraw = true;
      if (err instanceof GPUInitializationError)
        reportError(this, "This browser can't draw the map. The list of sightings still works.", {cause: err, fingerprint: ['maplibre-no-webgl2']});
      else
        reportError(this, "Couldn't draw the map. The list of sightings still works.", {cause: err});
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
      addImages(map).catch(err => {
        // An icon that arrived after the map was taken off the page has nowhere to go.
        if (map === this.#map) console.error('Failed to load map icons:', err);
      });
      this.#drawAll(map);
      // The menu offers a layer only when the style has it: the water regions come with a
      // basemap version that has them.
      this.layerControl.available = new Set(REFERENCE_LAYERS.map(l => l.id)
        .filter(id => REFERENCE_LAYER_IDS[id].some(layer => map.getLayer(layer))));
      this.drafts.attach(map);
      // OpenLayers announced the first view as a move, which is what first
      // writes a position into the URL; keep that.
      this.onMoveEnd();
    });
    // A phone takes back a background tab's WebGL context. MapLibre drops the
    // style with it, sources and all, and given the context back rebuilds the
    // style from a copy saved at the loss, a frame or more later. Data set in
    // between waits in #data, and everything is drawn again once the style is back.
    map.on('webglcontextlost', () => { this.#loaded = false; });
    map.on('webglcontextrestored', () => map.once('style.load', () => {
      this.#loaded = true;
      this.#drawAll(map);
      this.drafts.render();
    }));
    map.on('click', this.onClick.bind(this));
    map.on('mousemove', this.onPointerMove.bind(this));
    map.on('mouseout', () => { this.regionName = null; });
    map.on('moveend', this.onMoveEnd.bind(this));

    // The arrows' imputed positions say where the animals are now, so they move on with the clock.
    this.#clock = setInterval(() => this.#drawImputedPositions(), 60_000);
  }

  #createMap(): MapLibreMap {
    return new MapLibreMap({
      container: this.mapRef.value!,
      style: baseStyle(),
      // Past the basemap's coarse map, and zoomed out further than it goes, it draws
      // nothing, and the map would look broken there.
      maxBounds: BASEMAP_BOUNDS,
      minZoom: BASEMAP_MIN_ZOOM,
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

  // Taken off the page, the map gives back its WebGL context and its worker; put
  // back, it is made again where it was, with the same data.
  override connectedCallback() {
    super.connectedCallback();
    if (this.hasUpdated && !this.#map && !this.#cannotDraw)
      this.#build();
  }

  override disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this.#clock);
    this.drafts.detach();
    this.#stopWaitingToFrame?.();
    this.skipNextMoveEvent = false;
    const map = this.#map;
    if (!map)
      return;
    const {lng, lat} = map.getCenter();
    [this.centerX, this.centerY] = fromLonLat([lng, lat]);
    this.zoom = permalinkZoom(map.getZoom());
    map.remove();
    this.#map = undefined;
    this.#loaded = false;
  }

  /** Everything set on the element, drawn on a map whose style has just loaded. */
  #drawAll(map: MapLibreMap) {
    for (const [id, data] of this.#data)
      map.getSource<GeoJSONSource>(id)!.setData(data);
    this.#applyVisibility();
    this.#select(this.#selectedId);
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
      layers: [...SUBJECT_LAYERS, ...OCCURRENCE_LAYERS, ...CLICKABLE_REFERENCE_LAYERS],
    });
    // One of an open subject's sightings: to its day, selected, which closes the subject.
    if (top && SUBJECT_LAYERS.includes(top.layer.id)) {
      const detail = {date: top.properties['date'], occurrenceId: top.properties['id']};
      this.dispatchEvent(new CustomEvent('go-to-occurrence', {bubbles: true, composed: true, detail}));
      return;
    }
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
    // A phone has no pointer to hover with: a tap on open water names its region.
    if (!top) this.regionName = this.#regionAt(evt.point);
    const kind = top?.properties['kind'];
    if (kind === 'Hydrophone' || kind === 'SalmonCountingSite')
      window.open(top!.properties['url'], '_blank');
    // Our own page, so the same tab: the map's state, this layer included, is
    // in the URL, and Back returns to it.
    else if (kind === 'Haulout')
      window.location.assign(hauloutPath({id: top!.properties['id'], name: top!.properties['name']}));
  }

  /** The water region's name at a point, as a card would say it, while the regions are shown. */
  @state() private regionName: string | null = null;

  #regionAt(point: {x: number, y: number}): string | null {
    if (!this.visibleLayers.has('regions') || !this.#map?.getLayer(REGION_FILL)) return null;
    const [region] = this.#map.queryRenderedFeatures([point.x, point.y], {layers: [REGION_FILL]});
    return (region?.properties['name'] as string | undefined) ?? null;
  }

  #featureAt(point: {x: number, y: number}): MapGeoJSONFeature | undefined {
    return this.#map!.queryRenderedFeatures(around(point, 2), {
      layers: [...SUBJECT_LAYERS, ...OCCURRENCE_LAYERS, ...CLICKABLE_REFERENCE_LAYERS],
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
    const layer = feature?.layer.id ?? '';
    target.title = CLICKABLE_REFERENCE_LAYERS.includes(layer) ? feature!.properties['name'] ?? ''
      : SUBJECT_LAYERS.includes(layer) ? feature!.properties['title'] ?? ''
      : '';
    this.regionName = this.#regionAt(evt.point);
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
    // One ring per place, radius and colour: a hydrophone that heard several bouts in a
    // day would otherwise stack their rings into a darker one, claiming nothing more.
    const rings = new Map(compactMap(placed, uncertaintyRing).map(ring => [JSON.stringify([ring.geometry, ring.properties]), ring]));
    this.#setData('uncertainty', {type: 'FeatureCollection', features: [...rings.values()]});

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
        // A basemap layer is there only in a version that has it, such as the water regions.
        if (this.#map!.getLayer(id))
          this.#map!.setLayoutProperty(id, 'visibility', this.visibleLayers.has(layer as ReferenceLayer) ? 'visible' : 'none');
  }

  protected willUpdate(changedProperties: PropertyValues): void {
    if (changedProperties.has('visibleLayers')) {
      this.#applyVisibility();
      if (!this.visibleLayers.has('regions')) this.regionName = null;
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

  /**
   * An animal's or group's sightings, drawn in place of the day's while it is open in the
   * sidebar (decision 096), or null to take them off. Older reports are fainter; the
   * newest is larger. When none of them is in view, the map frames them.
   */
  public setSubjectSightings(sightings: readonly SubjectSighting[] | null, color: string) {
    this.#setData('subject', {type: 'FeatureCollection', features: sightings ? subjectFeatures(sightings, color) : []});
    const map = this.#map;
    if (!map || !sightings?.length || sightings.some(({lon, lat}) => map.getBounds().contains([lon, lat])))
      return;
    const lons = sightings.map(s => s.lon), lats = sightings.map(s => s.lat);
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      {padding: 40, maxZoom: mapZoom(12), animate: false});
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
    this.#stopWaitingToFrame?.();
    const onResize = () => {
      if (container.clientWidth === 0 || container.clientHeight === 0) return;
      map.off('resize', onResize);
      this.#stopWaitingToFrame = null;
      this.zoomToExtent(extent);
    };
    map.on('resize', onResize);
    this.#stopWaitingToFrame = () => {
      map.off('resize', onResize);
      this.#stopWaitingToFrame = null;
      this.#pendingFrame = extent;
    };
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

/**
 * Where the animal may have been, when its source says so (decision 077): a polygon
 * in longitude and latitude, so its radius is true on the water.
 */
function uncertaintyRing(occurrence: Occurrence): Feature | undefined {
  const radius = uncertaintyRadius(occurrence);
  const {lat, lon} = occurrence.location;
  if (!radius || lon == null || lat == null)
    return undefined;
  const ring = circle([lon, lat], radius / 1000, {steps: 64, units: 'kilometers'});
  return {...ring, properties: ringColours(occurrenceProperties(occurrence).color)};
}

/** One of an open subject's sightings: which report, when, and where (decision 096). */
export interface SubjectSighting {
  occurrence_id: string;
  observed_at: string;
  lon: number;
  lat: number;
}

/** The subject's sightings as the map draws them: faded from the newest to the oldest. */
export function subjectFeatures(sightings: readonly SubjectSighting[], color: string): Feature[] {
  const times = sightings.map(s => Date.parse(s.observed_at));
  const newest = Math.max(...times), oldest = Math.min(...times);
  const span = newest - oldest;
  return sightings.map((s, i) => {
    const date = observedDate(s.observed_at);
    return {
      type: 'Feature',
      geometry: {type: 'Point', coordinates: [s.lon, s.lat]},
      properties: {
        id: s.occurrence_id,
        date: date.toString(),
        title: `Reported ${formatDate(date, {day: 'numeric', month: 'short', year: 'numeric'})}`,
        color,
        // From a quarter for the oldest to nearly whole for the newest, so the newest read first.
        opacity: span ? 0.25 + 0.7 * (times[i]! - oldest) / span : 0.95,
        newest: times[i] === newest,
      },
    };
  });
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
