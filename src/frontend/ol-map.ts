import { LitElement, PropertyValues, css, html } from 'lit'
import { customElement, property, query, queryAll } from 'lit/decorators.js'
import OpenLayersMap from "ol/Map";
import View from "ol/View";

// imports below these lines smell like they support functionality that should be factored out
import VectorLayer from 'ol/layer/Vector';
import TileLayer from 'ol/layer/Tile';
import { fromLonLat } from 'ol/proj';
import XYZ from 'ol/source/XYZ';
import ObservationSource from './observation-source';
import { featureStyle } from './style';
import { Temporal } from 'temporal-polyfill';

const sphericalMercator = 'EPSG:3857';

const coordinates = {
  latitude: 47.8,
  longitude: -122.450,
  time: Temporal.Now.instant(),
};

// This is a thin wrapper around imperative code driving OpenLayers.
// The code is informed by the `openlayers-elements` project, but we avoid taking it as a dependency.
@customElement('ol-map')
export class OlMap extends LitElement {
  public map?: OpenLayersMap = undefined

  @query('#map')
  public mapElement!: HTMLDivElement

  static styles = css`
    :host { display: block; }
    #map { height: 100%; }
  `
  public render() {
    return html`
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ol@v10.4.0/ol.css" type="text/css" />
      <style>
      </style>
      <div id="map"></div>
      <slot></slot>
    `;
  }

  public firstUpdated(_changedProperties: PropertyValues): void {
    this.map = new OpenLayersMap({
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
        new VectorLayer({
          source: new ObservationSource(coordinates),
          style: featureStyle,
        }),
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

declare global {
  interface HTMLElementTagNameMap {
    "ol-map": OlMap;
  }
}
