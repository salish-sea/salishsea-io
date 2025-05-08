import { LitElement, css, html } from 'lit'
import type { PropertyValues } from 'lit';
import { customElement, property, query} from 'lit/decorators.js'
import OpenLayersMap from "ol/Map.js";
import View from "ol/View.js";
import Select, { SelectEvent } from 'ol/interaction/Select.js';
import {defaults as defaultInteractions} from 'ol/interaction/defaults.js';
import Link from 'ol/interaction/Link.js';
import './obs-panel.ts';
import './obs-summary.ts';
import viewingLocationKML from '../assets/orcanetwork-viewing-locations.kml?url';

// imports below these lines smell like they support functionality that should be factored out
import VectorLayer from 'ol/layer/Vector.js';
import TileLayer from 'ol/layer/Tile.js';
import { fromLonLat } from 'ol/proj.js';
import XYZ from 'ol/source/XYZ.js';
import { editStyle, featureStyle, selectedObservationStyle} from './style.ts';
import type Point from 'ol/geom/Point.js';
import KML from 'ol/format/KML.js';
import VectorSource from 'ol/source/Vector.js';
import mapContext from './map-context.ts';
import { provide } from '@lit/context';
import type Feature from 'ol/Feature.js';
import Modify from 'ol/interaction/Modify.js';
import type Geometry from 'ol/geom/Geometry.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { all } from 'ol/loadingstrategy.js';
import { never } from 'ol/events/condition.js';
import { containsCoordinate } from 'ol/extent.js';

const sphericalMercator = 'EPSG:3857';
const initialCenter = [-122.450, 47.8];
const initialZoom = 9;

// This is a thin wrapper around imperative code driving OpenLayers.
// The code is informed by the `openlayers-elements` project, but we avoid taking it as a dependency.
@customElement('obs-map')
export class ObsMap extends LitElement {
  public drawingSource = new VectorSource();
  public temporalSource = new VectorSource<Feature<Geometry>>({
    format: new GeoJSON<Feature<Geometry>>,
    strategy: all,
  });
  // https://www.google.com/maps/d/u/0/kml?mid=1xIsepZY5h_8oA2nd6IwJN-Y7lhk
  #viewingLocations = new VectorLayer({
    maxResolution: 40,
    source: new VectorSource({
      attributions: 'Sighting Viewpoints by Thorsten Lisker and Alisa Lemire Brooks of Orca Network',
      url: viewingLocationKML,
      format: new KML(),
    }),
  });

  @property({type: String, reflect: true})
  set url(url: string) {
    this.temporalSource.setUrl(url);
    this.temporalSource.refresh();
  }
  get url() {
    return this.temporalSource.getUrl() as string;
  }

  @property({type: String, reflect: true})
  date: string | undefined

  @property({type: String, reflect: true})
  focusedSightingId: string | undefined

  #link = new Link({params: ['x', 'y', 'z'], replace: true});
  #modify = new Modify({
    deleteCondition: never,
    insertVertexCondition: never,
    source: this.drawingSource,
    style: editStyle,
  });
  #select = new Select({
    filter: (f) => f.get('kind') === 'Sighting',
    multi: false,
    style: selectedObservationStyle,
  });

  @provide({context: mapContext})
  public map = new OpenLayersMap({
    interactions: defaultInteractions().extend([this.#link, this.#modify, this.#select]),
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
      new VectorLayer({
        source: this.temporalSource,
        style: featureStyle,
      }),
      this.#viewingLocations,
      new VectorLayer({
        source: this.drawingSource,
        style: featureStyle,
      }),
    ],
    view: new View({
      center: fromLonLat(initialCenter),
      projection: sphericalMercator,
      zoom: initialZoom,
    }),
  });

  @query('#map')
  public mapElement!: HTMLDivElement

  static styles = css`
:host {
  align-items: stretch;
  display: flex;
  flex-direction: row;
  flex-grow: 1;
  overflow: auto;
}
#map {
  flex-grow: 1;
}
  `

  constructor() {
    super();
    this.temporalSource.on('change', () => {
      const features = this.temporalSource.getFeatures();
      const evt = new CustomEvent('sightings-changed', {bubbles: true, composed: true, detail: features})
      this.dispatchEvent(evt);
    })
    this.#select.on('select', (e: SelectEvent) => {
      const id = e.selected[0]?.getId() as string | undefined;
      const evt = new CustomEvent('focus-sighting', {bubbles: true, composed: true, detail: id});
      this.dispatchEvent(evt);
    });
    const initialD = this.#link.track('d', this.selectDate.bind(this));
    if (initialD) {
      this.selectDate(initialD);
    }
  }

  public render() {
    return html`
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ol@v10.4.0/ol.css" type="text/css" />
      <div id="map"></div>
    `;
  }

  public firstUpdated(_changedProperties: PropertyValues): void {
    this.map.setTarget(this.mapElement);
  }

  public selectFeature(feature: Feature) {
    const selection = this.#select.getFeatures();
    selection.clear();
    selection.push(feature);
  }

  protected selectDate(date: string) {
    const evt = new CustomEvent('date-selected', {bubbles: true, composed: true, detail: date});
    this.dispatchEvent(evt);
  }

  protected willUpdate(changedProperties: PropertyValues): void {
    if (changedProperties.has('date'))
      this.#link.update('d', this.date || null);

    if (changedProperties.has('focusedSightingId') && this.focusedSightingId) {
      const feature = this.temporalSource.getFeatureById(this.focusedSightingId) as Feature<Point>;
      this.ensureSightingInViewport(feature)
    }
  }

  public ensureSightingInViewport(feature: Feature<Point>) {
    const view = this.map.getView();
    const mapExtent = view.calculateExtent(this.map.getSize());
    const featureCoordinates = feature.getGeometry()!.getCoordinates();
    if (! containsCoordinate(mapExtent, featureCoordinates)) {
      view.animate({zoom: 12});
      view.animate({center: featureCoordinates});
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "obs-map": ObsMap;
  }
}
