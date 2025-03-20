import { LitElement, css, html } from 'lit'
import type { PropertyValues } from 'lit';
import { customElement, query, state } from 'lit/decorators.js'
import OpenLayersMap from "ol/Map.js";
import View from "ol/View.js";
import Select from 'ol/interaction/Select.js';
import {defaults as defaultInteractions} from 'ol/interaction/defaults.js';
import DragBox from 'ol/interaction/DragBox.js';
import Link from 'ol/interaction/Link.js';
import './obs-panel.ts';
import './obs-summary.ts';

// imports below these lines smell like they support functionality that should be factored out
import VectorLayer from 'ol/layer/Vector.js';
import TileLayer from 'ol/layer/Tile.js';
import { fromLonLat } from 'ol/proj.js';
import XYZ from 'ol/source/XYZ.js';
import TemporalFeatureSource from './temporal-feature-source.ts';
import { featureStyle, selectedObservationStyle } from './style.ts';
import { Temporal } from 'temporal-polyfill';
import { platformModifierKeyOnly } from 'ol/events/condition.js';
import type { CollectionEvent } from 'ol/Collection.js';
import type { FeatureLike } from 'ol/Feature.js';
import type {Feature as GeoJSONFeature, Point as GeoJSONPoint} from 'geojson';
import type { SightingProperties } from '../types.ts';
import type Point from 'ol/geom/Point.js';

const sphericalMercator = 'EPSG:3857';

const coordinates = {
  latitude: 47.8,
  longitude: -122.450,
  time: Temporal.Now.instant(),
};

const temporalSource = new TemporalFeatureSource(coordinates);
const temporalLayer = new VectorLayer({
  source: temporalSource,
  style: featureStyle,
});

const select = new Select({
  layers: [temporalLayer],
  style: selectedObservationStyle,
});
const selection = select.getFeatures();
selection.on('add', (e: CollectionEvent<FeatureLike>) => {
  console.log(e.element.getProperties());
});
const dragBox = new DragBox({
  condition: platformModifierKeyOnly,
});
const link = new Link({params: ['x', 'y', 'z'], replace: true});

// This is a thin wrapper around imperative code driving OpenLayers.
// The code is informed by the `openlayers-elements` project, but we avoid taking it as a dependency.
@customElement('ol-map')
export class OlMap extends LitElement {
  public map?: OpenLayersMap = undefined

  @query('#map')
  public mapElement!: HTMLDivElement

  static styles = css`
    :host { display: flex; align-items: stretch }
    #map { flex-grow: 1; }
    obs-panel { width: 320px; }
  `

  @state()
  private features: GeoJSONFeature<GeoJSONPoint, SightingProperties>[] = [];

  constructor() {
    super();
    temporalSource.on('change', () => {
      this.features = temporalSource
        .getFeatures()
        .filter(f => f.get('kind') === 'Sighting')
        .toSorted((a, b) => b.get('timestamp') - a.get('timestamp'))
        .map(f => {
          const point = f.getGeometry() as Point;
          const properties = f.getProperties() as SightingProperties;
          return {
            type: 'Feature',
            geometry: {type: 'Point', coordinates: point.getCoordinates()},
            properties,
          };
        })
    });
  }

  public render() {
    return html`
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ol@v10.4.0/ol.css" type="text/css" />
      <div id="map"></div>
      <obs-panel>
        ${this.features.map(feature => {
          const {body, count, name, date, time, prev_date} = feature.properties;
          return html`<obs-summary .body=${body} .count=${count} .name=${name} .time=${time} .date=${date} .prev_date=${prev_date} />`
        })}
      </obs-panel>
    `;
  }

  public firstUpdated(_changedProperties: PropertyValues): void {
    this.map = new OpenLayersMap({
      interactions: defaultInteractions().extend([dragBox, link, select]),
      layers: [
        new TileLayer({
          source: new XYZ({urls: [
            'https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
            'https://server.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
          ]}),
        }),
        new TileLayer({
          source: new XYZ({
            // NB: this source is unmaintained
            url: "https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}",
          }),
        }),
        temporalLayer,
      ],
      target: this.mapElement,
      view: new View({
        center: fromLonLat([coordinates.longitude, coordinates.latitude]),
        projection: sphericalMercator,
        zoom: 9,
      }),
    });
  }
}

dragBox.on('boxend', () => {
  const boxExtent = dragBox.getGeometry().getExtent();
  const features = temporalSource.getFeaturesInExtent(boxExtent);
  selection.clear();
  selection.extend(features);
  selection.changed();
});

declare global {
  interface HTMLElementTagNameMap {
    "ol-map": OlMap;
  }
}
