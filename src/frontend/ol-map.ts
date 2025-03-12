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
import Style from 'ol/style/Style';
import { FeatureLike } from 'ol/Feature';
import Circle from 'ol/style/Circle';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import Text from 'ol/style/Text';

const center = fromLonLat([-122.450, 47.8]);
const sphericalMercator = 'EPSG:3857';

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
          source: new ObservationSource(),
          style: observationStyle,
        }),
      ],
      target: this.mapElement,
      view: new View({
        center,
        projection: sphericalMercator,
        zoom: 9,
      }),
    });
  }
}

const observationStyle = (observation: FeatureLike) => {
  const fill = new Fill({color: 'rgba(255, 255, 255, 0.4)'});
  const stroke = new Stroke({color: '#3399CC'});
  const text = observation.get('name') ?? '';
  return [
    new Style({
      image: new Circle({
        radius: 6,
        fill,
        stroke,
      }),
      fill,
      stroke,
    }),
    new Style({
      text: new Text({
        fill: new Fill({color: '#000000'}),
        font: '10px monospace',
        offsetY: 1.5,
        text,
        textBaseline: 'middle',
      })
    }),
  ]
}

declare global {
  interface HTMLElementTagNameMap {
    "ol-map": OlMap;
  }
}
