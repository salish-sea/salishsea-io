import { LitElement, css, html } from 'lit'
import type { PropertyValues } from 'lit';
import { customElement, property, query} from 'lit/decorators.js'
import OpenLayersMap from "ol/Map.js";
import View from "ol/View.js";
import Select, { SelectEvent } from 'ol/interaction/Select.js';
import {defaults as defaultInteractions} from 'ol/interaction/defaults.js';
import './obs-panel.ts';
import './obs-summary.ts';
import viewingLocationURL from '../assets/orcanetwork-viewing-locations.geojson?url';
import hydrophonesURL from '../assets/orcasound-hydrophones.geojson?url';

// imports below these lines smell like they support functionality that should be factored out
import VectorLayer from 'ol/layer/Vector.js';
import TileLayer from 'ol/layer/Tile.js';
import XYZ from 'ol/source/XYZ.js';
import { editStyle, featureStyle, hydrophoneStyle, selectedObservationStyle, viewingLocationStyle} from './style.ts';
import type Point from 'ol/geom/Point.js';
import VectorSource from 'ol/source/Vector.js';
import type Feature from 'ol/Feature.js';
import Modify from 'ol/interaction/Modify.js';
import type Geometry from 'ol/geom/Geometry.js';
import GeoJSON from 'ol/format/GeoJSON.js';
import { all } from 'ol/loadingstrategy.js';
import { never } from 'ol/events/condition.js';
import { containsCoordinate } from 'ol/extent.js';
import type { Coordinate } from 'ol/coordinate.js';
import type MapBrowserEvent from 'ol/MapBrowserEvent.js';
import type { FeatureCollection } from 'geojson';
import olCSS from 'ol/ol.css?url';
import Collection from 'ol/Collection.js';

const sphericalMercator = 'EPSG:3857';

const geoJSON = new GeoJSON();

export type MapMoveDetail = {
  center: [number, number];
  zoom: number;
}

// This is a thin wrapper around imperative code driving OpenLayers.
// The code is informed by the `openlayers-elements` project, but we avoid taking it as a dependency.
@customElement('obs-map')
export class ObsMap extends LitElement {
  public drawingSource = new VectorSource();
  public temporalSource = new VectorSource<Feature<Geometry>>({
    features: new Collection(),
    strategy: all,
  });
  private temporalLayer = new VectorLayer({
    source: this.temporalSource,
    style: featureStyle,
  })
  private viewingLocationsLayer = new VectorLayer({
    minZoom: 12,
    source: new VectorSource({
      attributions: 'Sighting Viewpoints by Thorsten Lisker and Alisa Lemire Brooks of Orca Network.',
      format: new GeoJSON<Feature<Point>>(),
      strategy: all,
      url: viewingLocationURL,
    }),
    style: viewingLocationStyle,
  });
  private hydrophoneLayer = new VectorLayer({
    source: new VectorSource({
      format: new GeoJSON<Feature<Point>>(),
      strategy: all,
      url: hydrophonesURL,
    }),
    style: hydrophoneStyle,
  })

  @property({type: String, reflect: true})
  private focusedSightingId: string | undefined

  #modify = new Modify({
    deleteCondition: never,
    insertVertexCondition: never,
    source: this.drawingSource,
    style: editStyle,
  });
  #select = new Select({
    filter: (f) => f.get('kind') === 'Sighting',
    layers: [this.temporalLayer],
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
    interactions: defaultInteractions().extend([this.#modify, this.#select]),
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
      this.temporalLayer,
      this.viewingLocationsLayer,
      this.hydrophoneLayer,
      new VectorLayer({
        source: this.drawingSource,
        style: featureStyle,
      }),
    ],
    view: this.view,
  });

  @query('#map', true)
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
    this.#select.on('select', (e: SelectEvent) => {
      const id = e.selected[0]?.getId() as string | undefined;
      const evt = new CustomEvent('focus-sighting', {bubbles: true, composed: true, detail: id});
      this.dispatchEvent(evt);
    });
    this.map.on('singleclick', this.onClick.bind(this));
    this.map.on('moveend', this.onMoveEnd.bind(this));
  }

  public render() {
    return html`
      <link rel="stylesheet" href="${olCSS}" type="text/css" />
      <div id="map"></div>
    `;
  }

  protected onClick(evt: MapBrowserEvent<PointerEvent>) {
    if (evt.originalEvent.altKey) {
      // Prevent the Select from getting this click.
      return false;
    }

    const feature = this.map.getFeaturesAtPixel(evt.pixel).filter(f => f.get('kind') === 'Hydrophone')[0];
    if (!feature)
      return;
    window.open(feature.get('url'), '_blank')
  }

  protected onMoveEnd() {
    const detail: MapMoveDetail = {
      center: this.view.getCenter() as [number, number],
      zoom: this.view.getZoom()!
    };
    const evt = new CustomEvent('map-move', {bubbles: true, composed: true, detail});
    this.dispatchEvent(evt);
  }

  public firstUpdated(_changedProperties: PropertyValues): void {
    this.view.setCenter([this.centerX, this.centerY, this.zoom]);
    this.map.setTarget(this.mapElement);
    this.mapElement.addEventListener('pointerdown', evt => {
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
  }

  public setFeatures(features: FeatureCollection) {
    const collection = this.temporalSource.getFeaturesCollection()!;
    const olFeatures = geoJSON.readFeatures(features, {featureProjection: sphericalMercator});
    collection.clear();
    collection.extend(olFeatures);
  }

  public selectFeature(feature: Feature) {
    const selection = this.#select.getFeatures();
    selection.clear();
    selection.push(feature);
  }

  protected willUpdate(changedProperties: PropertyValues): void {
    if (changedProperties.has('focusedSightingId') && this.focusedSightingId) {
      const feature = this.temporalSource.getFeatureById(this.focusedSightingId) as Feature<Point>;
      const coords = feature.getGeometry()!.getCoordinates();
      this.ensureCoordsInViewport(coords);
    }
  }

  public ensureCoordsInViewport(coords: Coordinate) {
    const view = this.map.getView();
    const mapExtent = view.calculateExtent(this.map.getSize());
    if (! containsCoordinate(mapExtent, coords)) {
      view.animate({zoom: 12});
      view.animate({center: coords});
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "obs-map": ObsMap;
  }
}
