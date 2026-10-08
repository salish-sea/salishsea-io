import { LitElement, css, html } from 'lit'
import type { PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js'
import OpenLayersMap from "ol/Map.js";
import View from "ol/View.js";
import Select, { SelectEvent } from 'ol/interaction/Select.js';
import {defaults as defaultInteractions} from 'ol/interaction/defaults.js';
import './obs-panel.ts';
import './obs-summary.ts';

// imports below these lines smell like they support functionality that should be factored out
import VectorLayer from 'ol/layer/Vector.js';
import TileLayer from 'ol/layer/Tile.js';
import XYZ from 'ol/source/XYZ.js';
import { editStyle, hauloutStyle, hydrophoneStyle, occurrenceStyle, outsideRegionStyle, salmonCountingSiteStyle, selectedObservationStyle, sighterStyle, travelStyle, userLocationStyle, viewingLocationStyle} from './style.ts';
import Point from 'ol/geom/Point.js';
import Polygon, { circular } from 'ol/geom/Polygon.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Modify from 'ol/interaction/Modify.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { all } from 'ol/loadingstrategy.js';
import { never } from 'ol/events/condition.js';
import { unByKey } from 'ol/Observable.js';
import { containsCoordinate, type Extent } from 'ol/extent.js';
import type { Coordinate } from 'ol/coordinate.js';
import type MapBrowserEvent from 'ol/MapBrowserEvent.js';
import olCSS from 'ol/ol.css?url';
import type { Occurrence } from './types.ts';
import { LineString } from 'ol/geom.js';
import { occurrences2segments, segment2features, segment2travelLine } from './segments.ts';
import { fromLonLat, transformExtent } from 'ol/proj.js';
import { createRef, ref } from 'lit/directives/ref.js';
import { compactMap } from './utils.ts';
import type { Extent as RegionExtent } from './constants.ts';
import UserLocationControl from './user-location-control.ts';
import LayerControl from './layer-control.ts';
import { DEFAULT_LAYERS, type ReferenceLayer } from './reference-layers.ts';
import { fetchHauloutSites, hauloutPath, type HauloutSite } from './catalog.ts';
import { fetchStaticHauloutSites, readSource } from './read-path.ts';
import { reportError } from './report-error.ts';
import { geolocationErrorIsReportable } from './geolocation-message.ts';

const sphericalMercator = 'EPSG:3857';

export type LayersChangeDetail = Set<ReferenceLayer>;

export type MapMoveDetail = {
  center: [number, number];
  zoom: number;
}

// This is a thin wrapper around imperative code driving OpenLayers.
// The code is informed by the `openlayers-elements` project, but we avoid taking it as a dependency.
@customElement('obs-map')
export class ObsMap extends LitElement {
  public drawingSource = new VectorSource();
  public ocurrenceSource = new VectorSource<Feature<Point>>({
    features: [],
    strategy: all,
  });
  private occurrenceLayer = new VectorLayer({
    // Layer-level decluttering is what lets the labels negotiate space, and it
    // replaces the hand-tuned pixel offsets that still let two identifier
    // labels overprint near Victoria on an ordinary day (decision 029). It is
    // per-layer, so it does NOT stop an occurrence label colliding with a
    // hydrophone; that is a separate problem, and the reason infrastructure now
    // draws underneath.
    declutter: true,
    source: this.ocurrenceSource,
    style: (feature) => occurrenceStyle(feature.getProperties() as Occurrence, false),
  });
  private travelSource = new VectorSource<Feature<LineString>>({
    features: [],
    strategy: all,
  });
  private travelLayer = new VectorLayer({
    source: this.travelSource,
    style: (line, res) => travelStyle(line as Feature<LineString>, res),
  })
  private viewingLocationsLayer = new VectorLayer({
    // Markers appear a level earlier than before; the labels — the actual
    // clutter — stay gated behind zoom 12 in viewingLocationStyle.
    minZoom: 11,
    source: new VectorSource(),
    style: viewingLocationStyle,
  });
  private hydrophoneLayer = new VectorLayer({
    source: new VectorSource(),
    style: hydrophoneStyle,
  })
  private salmonCountingSiteLayer = new VectorLayer({
    source: new VectorSource(),
    style: salmonCountingSiteStyle,
  })
  // Loaded the first time it is switched on (decision 058): hidden by default,
  // so most visits never ask for it.
  private hauloutLayer = new VectorLayer({
    // The names declutter one another: the atlas maps some sites at several
    // points a few hundred metres apart, all under one name.
    declutter: true,
    source: new VectorSource<Feature<Point>>({
      attributions: 'Haul-out sites after Jeffries et al. 2000, <i>Atlas of Seal and Sea Lion Haulout Sites in Washington</i>, WDFW.',
    }),
    style: hauloutStyle,
  });
  private hauloutsLoaded: Promise<void> | null = null;
  private referenceLayers: Record<ReferenceLayer, VectorLayer> = {
    viewpoints: this.viewingLocationsLayer,
    hydrophones: this.hydrophoneLayer,
    salmon: this.salmonCountingSiteLayer,
    haulouts: this.hauloutLayer,
  };

  /** Which reference layers are drawn (GH #453). A change made with the map's own control is dispatched as `layers-change`. */
  @property({attribute: false})
  public visibleLayers: ReadonlySet<ReferenceLayer> = DEFAULT_LAYERS;

  private layerControl = new LayerControl({
    visible: this.visibleLayers,
    onChange: (detail: LayersChangeDetail) =>
      this.dispatchEvent(new CustomEvent('layers-change', {bubbles: true, composed: true, detail})),
  });
  private userLocationFeature = new Feature<Point>(new Point([]));
  private userLocationLayer = new VectorLayer({
    source: new VectorSource({features: [this.userLocationFeature]}),
    style: userLocationStyle,
  });

  @property({type: String, reflect: true})
  public focusedOccurrenceId: string | undefined

  /**
   * Lon/lat bounds of the active region, or `null` for "Everywhere".
   *
   * Everything outside is shaded. The point is GH #16: without it, panning past
   * the filter shows empty water that reads as "no whales were seen here" when
   * it means "we are not showing you this". The mask says which.
   */
  @property({attribute: false})
  public maskExtent: RegionExtent | null = null;

  /**
   * Lon/lat bounds the active region opens framed to: the map's default view.
   *
   * At that zoom and further out the mask is hidden. Framed, the region already
   * fills the window, and the shading would only grey its margins; it earns its
   * place once you zoom in and can pan past the region's edge.
   */
  @property({attribute: false})
  public frameExtent: RegionExtent | null = null;

  private maskSource = new VectorSource<Feature<Polygon>>();
  private maskLayer = new VectorLayer({
    source: this.maskSource,
    style: outsideRegionStyle,
    // Above the basemap, below the occurrences: a sighting that sits just
    // outside the region (a stale ?o= permalink) must stay visible and
    // clickable rather than being greyed into the background.
    zIndex: 1,
  });

  private modify = new Modify({
    deleteCondition: never,
    insertVertexCondition: never,
    source: this.drawingSource,
    style: editStyle,
  });
  private select = new Select({
    layers: [this.occurrenceLayer],
    multi: false,
    style: selectedObservationStyle,
  });

  @property({type: Number, reflect: true})
  private centerX!: number

  @property({type: Number, reflect: true})
  private centerY!: number

  @property({type: Number, reflect: true})
  private zoom!: number

  private view = new View({
    projection: sphericalMercator,
    zoom: 9,
  })

  public map = new OpenLayersMap({
    interactions: defaultInteractions().extend([this.modify, this.select]),
    layers: [
      new TileLayer({
        source: new XYZ({
          attributions: 'Base map by Esri and its data providers',
          urls: [
            'https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
            'https://server.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
          ]
        }),
      }),
      new TileLayer({
        source: new XYZ({
          // NB: this source is unmaintained
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}",
        }),
      }),
      this.maskLayer,
      // Infrastructure under the data. These are places that are always there —
      // context for reading the map, not things anybody saw today — and drawing
      // them last let a hydrophone cover a sighting (salish-fll.3).
      this.hauloutLayer,
      this.viewingLocationsLayer,
      this.hydrophoneLayer,
      this.salmonCountingSiteLayer,
      this.travelLayer,
      this.occurrenceLayer,
      this.userLocationLayer,
      new VectorLayer({
        source: this.drawingSource,
        style: (f) => f.get('kind') === 'Sighter' ? sighterStyle : occurrenceStyle(f.getProperties() as Occurrence),
      }),
    ],
    view: this.view,
  });

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
user-location-control {
  position: absolute;
  left: 0.5em;
  top: 4em;
}
user-location-control svg { fill: currentColor; }
layer-control {
  right: 0.5em;
  top: 0.5em;
}
layer-control svg.inline-icon { fill: currentColor; }
layer-control .layer-menu {
  background: var(--ol-background-color, white);
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
user-location-control.inactive svg { color: var(--ol-subtle-foreground-color); }
@media (pointer: coarse) {
  user-location-control {
    top: 5.3em;
  }
  layer-control label {
    font-size: 1rem;
    padding: 0.45em 0;
  }
}
  `

  constructor() {
    super();
    if ('geolocation' in navigator)
      this.map.addControl(new UserLocationControl({
        onLocationUpdated: this.onLocationUpdated.bind(this),
        onLocationInactive: this.onLocationInactive.bind(this),
        onLocationError: (message, error) =>
          reportError(this, message, {cause: error, capture: geolocationErrorIsReportable(error)}),
      }));
    this.select.on('select', (e: SelectEvent) => {
      const occurrence = e.selected[0]?.getProperties() || null;
      const evt = new CustomEvent('focus-occurrence', {bubbles: true, composed: true, detail: occurrence});
      this.dispatchEvent(evt);
    });
    this.map.addControl(this.layerControl);
    this.map.on('singleclick', this.onClick.bind(this));
    this.map.on('pointermove', this.onPointerMove.bind(this));
    this.map.on('moveend', this.onMoveEnd.bind(this));
    this.map.on('change:size', () => this.updateMaskMinZoom());
  }

  public render() {
    return html`
      <link rel="stylesheet" href="${olCSS}" type="text/css" />
      <div ${ref(this.mapRef)} id="map"></div>
    `;
  }

  protected onClick(evt: MapBrowserEvent) {
    if (evt.originalEvent.altKey) {
      // Prevent the Select from getting this click.
      return false;
    }

    // The topmost feature only: a sighting drawn over a site is the sighting's
    // click, which the Select interaction already has.
    const feature = this.referenceFeatureAt(evt.pixel);
    const kind = feature?.get('kind');
    if (kind === 'Hydrophone' || kind === 'SalmonCountingSite')
      window.open(feature!.get('url'), '_blank');
    // Our own page, so the same tab: the map's state, this layer included, is
    // in the URL, and Back returns to it.
    else if (kind === 'Haulout')
      window.location.assign(hauloutPath({id: feature!.get('id'), name: feature!.get('name')}));
  }

  private referenceFeatureAt(pixel: number[]) {
    // Not the mask: outside the region it is the topmost feature everywhere,
    // and would make every site there unclickable.
    const top = this.map.forEachFeatureAtPixel(pixel, f => f, {
      hitTolerance: 2,
      layerFilter: layer => layer !== this.maskLayer,
    });
    return top && ['Hydrophone', 'SalmonCountingSite', 'Haulout'].includes(top.get('kind')) ? top : undefined;
  }

  // A site's name at any zoom, since its label shows only from zoom 12, and a
  // hand where a click goes somewhere.
  protected onPointerMove(evt: MapBrowserEvent) {
    const target = this.mapRef.value;
    if (evt.dragging || !target)
      return;
    const feature = this.referenceFeatureAt(evt.pixel);
    target.style.cursor = feature ? 'pointer' : '';
    target.title = feature?.get('name') ?? '';
  }

  private skipNextMoveEvent = false;

  protected onMoveEnd() {
    if (this.skipNextMoveEvent) {
      this.skipNextMoveEvent = false;
      return;
    }
    const detail: MapMoveDetail = {
      center: this.view.getCenter() as [number, number],
      zoom: this.view.getZoom()!
    };
    const evt = new CustomEvent('map-move', {bubbles: true, composed: true, detail});
    this.dispatchEvent(evt);
  }

  /**
   * Programmatically set the map view (center and zoom)
   * @param x - X coordinate in map projection (EPSG:3857)
   * @param y - Y coordinate in map projection (EPSG:3857)
   * @param zoom - Zoom level
   * @param options - Optional configuration
   * @param options.skipEvent - If true, suppresses the 'map-move' event
   */
  public setView(x: number, y: number, zoom: number, options: {skipEvent?: boolean} = {}) {
    if (options.skipEvent) {
      this.skipNextMoveEvent = true;
    }
    this.view.setCenter([x, y]);
    this.view.setZoom(zoom);
  }

  public firstUpdated(_changedProperties: PropertyValues): void {
    this.view.setCenter([this.centerX, this.centerY]);
    this.view.setZoom(this.zoom);
    this.map.setTarget(this.mapRef.value!);
    this.mapRef.value!.addEventListener('pointerdown', evt => {
      if (! evt.altKey)
        return;

      const pixel = this.map.getEventPixel(evt);
      const sighting = this.map.getFeaturesAtPixel(pixel).filter(f => f.get('kind') === 'Sighting')[0];
      if (sighting) {
        const props = sighting.getProperties();
        const event = new CustomEvent('clone-sighting', {bubbles: true, composed: true, detail: props});
        this.dispatchEvent(event);
      }
    });

    // Load GeoJSON layers asynchronously
    this.loadViewingLocations();
    this.loadHydrophones();
    this.loadSalmonCountingSites();
  }

  private async loadViewingLocations() {
    try {
      const { default: geojsonText } = await import('./assets/orcanetwork-viewing-locations.geojson?raw');
      const features = new GeoJSON().readFeatures(geojsonText, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857'
      });
      this.viewingLocationsLayer.getSource()!.addFeatures(features);
      this.viewingLocationsLayer.getSource()!.setAttributions(
        'Sighting Viewpoints by Thorsten Lisker and Alisa Lemire Brooks of Orca Network.'
      );
    } catch (err) {
      console.error('Failed to load viewing locations:', err);
    }
  }

  private async loadHydrophones() {
    try {
      const { default: geojsonText } = await import('./assets/orcasound-hydrophones.geojson?raw');
      const features = new GeoJSON().readFeatures(geojsonText, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857'
      });
      this.hydrophoneLayer.getSource()!.addFeatures(features);
    } catch (err) {
      console.error('Failed to load hydrophones:', err);
    }
  }

  private loadHaulouts() {
    this.hauloutsLoaded ??= (readSource() === 'static' ? fetchStaticHauloutSites() : fetchHauloutSites())
      .then(sites => this.hauloutLayer.getSource()!.addFeatures(compactMap(sites, hauloutFeature)))
      .catch(err => {
        // Not latched, so switching the layer off and on again retries.
        this.hauloutsLoaded = null;
        reportError(this, "Couldn't load the haul-out sites.", {cause: err});
      });
  }

  private async loadSalmonCountingSites() {
    try {
      const { default: geojsonText } = await import('./assets/orcasalmon-counting-sites.geojson?raw');
      const features = new GeoJSON().readFeatures(geojsonText, {
        dataProjection: 'EPSG:4326',
        featureProjection: 'EPSG:3857'
      });
      this.salmonCountingSiteLayer.getSource()!.addFeatures(features);
    } catch (err) {
      console.error('Failed to load salmon counting sites:', err);
    }
  }

  public setOccurrences(occurrences: Occurrence[]) {
    const segments = occurrences2segments(occurrences);
    const features = segments.flatMap(segment2features);
    this.ocurrenceSource.clear()
    this.ocurrenceSource.addFeatures(features);

    const travelLines = compactMap(segments, segment2travelLine);
    this.travelSource.clear()
    this.travelSource.addFeatures(travelLines);

    // Select the focused occurrence if one is set
    if (this.focusedOccurrenceId) {
      const feature = this.ocurrenceSource.getFeatureById(this.focusedOccurrenceId) as Feature<Point>;
      if (feature) {
        this.selectFeature(feature);
      }
    }
  }

  public selectFeature(feature: Feature) {
    const selection = this.select.getFeatures();
    selection.clear();
    selection.push(feature);
  }

  protected willUpdate(changedProperties: PropertyValues): void {
    if (changedProperties.has('visibleLayers')) {
      for (const [id, layer] of Object.entries(this.referenceLayers))
        layer.setVisible(this.visibleLayers.has(id as ReferenceLayer));
      this.layerControl.visible = this.visibleLayers;
      if (this.visibleLayers.has('haulouts'))
        this.loadHaulouts();
    }
    if (changedProperties.has('maskExtent'))
      this.renderMask();
    if (changedProperties.has('frameExtent'))
      this.updateMaskMinZoom();
    if (changedProperties.has('focusedOccurrenceId') && this.focusedOccurrenceId) {
      const feature = this.ocurrenceSource.getFeatureById(this.focusedOccurrenceId) as Feature<Point>;
      if (feature) {
        this.selectFeature(feature);
        const coords = feature.getGeometry()!.getCoordinates();
        this.ensureCoordsInViewport(coords);
      }
    }
  }

  /**
   * Shade the world outside the active region: one polygon covering everything,
   * with the region punched out as a hole.
   *
   * A rectangle in lon/lat is still a rectangle in EPSG:3857 — it is a
   * cylindrical projection, so constant longitude stays constant x and constant
   * latitude stays constant y — which is why the corners can simply be
   * transformed rather than densified along the edges.
   */
  private renderMask() {
    this.maskSource.clear();
    if (!this.maskExtent)
      return;

    const [minLon, minLat, maxLon, maxLat] = this.maskExtent;
    // ±85 rather than ±90: the Mercator projection is undefined at the poles.
    const outer = [
      fromLonLat([-180, -85]), fromLonLat([180, -85]),
      fromLonLat([180, 85]), fromLonLat([-180, 85]), fromLonLat([-180, -85]),
    ];
    // Wound opposite to the outer ring, per the GeoJSON convention for holes.
    const hole = [
      fromLonLat([minLon, minLat]), fromLonLat([minLon, maxLat]),
      fromLonLat([maxLon, maxLat]), fromLonLat([maxLon, minLat]), fromLonLat([minLon, minLat]),
    ];
    this.maskSource.addFeature(new Feature(new Polygon([outer, hole])));
  }

  /**
   * Hide the mask at the default zoom and further out: the zoom framing
   * `frameExtent` gives in the current window, so it follows the region and the
   * window's size. OpenLayers shows a layer only above its minZoom.
   */
  private updateMaskMinZoom() {
    const size = this.map.getSize();
    this.maskLayer.setMinZoom(this.frameExtent && size && size[0]! > 0 && size[1]! > 0
      ? framingZoom(this.view, this.frameExtent, size)
      : -Infinity);
  }

  public ensureCoordsInViewport(coords: Coordinate) {
    const view = this.map.getView();
    const mapExtent = view.calculateExtent(this.map.getSize());
    if (! containsCoordinate(mapExtent, coords)) {
      view.animate({zoom: 12});
      view.animate({center: coords});
    }
  }

  public zoomToExtent(extent: Extent) {
    const view = this.map.getView();
    const transformedExtent = transformExtent(extent, 'EPSG:4326', view.getProjection());
    view.fit(transformedExtent);
  }

  /**
   * Like {@link zoomToExtent}, but safe to call before the map is on screen.
   *
   * `view.fit` sizes the viewport against `map.getSize()`, which is undefined
   * until the target element has been laid out and rendered — so a fit issued
   * from a parent's `firstUpdated` silently does nothing. Defer to the first
   * size when that is the case.
   *
   * Wait for the size, not for a render: OpenLayers measures the target with a
   * ResizeObserver, so the size lands before anything is drawn, whereas
   * `rendercomplete` waits for every tile. Fitting then let the default view
   * show for a second and visibly jump sideways into the region.
   */
  public frameExtentWhenReady(extent: Extent) {
    // `getSize()` returns an array — truthy even when it is [0, 0], which is
    // what you get between setTarget and layout. Fitting to a zero-width
    // viewport is the same silent no-op as fitting with no size at all.
    const hasArea = () => {
      const size = this.map.getSize();
      return !!size && size[0]! > 0 && size[1]! > 0;
    };
    if (hasArea()) {
      this.zoomToExtent(extent);
      return;
    }
    const key = this.map.on('change:size', () => {
      if (!hasArea()) return;
      unByKey(key);
      this.zoomToExtent(extent);
    });
  }

  public onLocationUpdated({longitude, latitude}: {longitude: number; latitude: number}) {
    const coordinate = fromLonLat([longitude, latitude]);
    const geometry = this.userLocationFeature.getGeometry()!;
    if (geometry.getCoordinates().length === 0)
      this.ensureCoordsInViewport(coordinate);
    this.userLocationFeature.getGeometry()!.setCoordinates(coordinate);
  }

  public onLocationInactive() {
    const geometry = this.userLocationFeature.getGeometry()!;
    geometry.setCoordinates([]);
  }
}

function hauloutFeature({id, name, location, radius_m}: HauloutSite): Feature<Point> | undefined {
  if (location.lon === null || location.lat === null)
    return undefined;
  const lonLat = [location.lon, location.lat];
  const feature = new Feature({
    geometry: new Point(fromLonLat(lonLat)),
    kind: 'Haulout',
    id,
    name,
    ring: circular(lonLat, radius_m, 64).transform('EPSG:4326', sphericalMercator),
  });
  feature.setId(`haulout:${id}`);
  return feature;
}

declare global {
  interface HTMLElementTagNameMap {
    "obs-map": ObsMap;
  }
}

/**
 * The zoom `view.fit` lands on for `extent` (lon/lat) in a window of `size` pixels,
 * plus a hair, so the view sitting exactly on it isn't over it by a rounding error.
 */
export function framingZoom(view: View, extent: RegionExtent, size: readonly number[]): number {
  const projected = transformExtent([...extent], 'EPSG:4326', view.getProjection());
  return view.getZoomForResolution(view.getResolutionForExtent(projected, [size[0]!, size[1]!]))! + 1e-6;
}
