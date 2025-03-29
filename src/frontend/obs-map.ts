import { LitElement, css, html } from 'lit'
import type { PropertyValues } from 'lit';
import { customElement, query, state } from 'lit/decorators.js'
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
import TemporalFeatureSource from './temporal-feature-source.ts';
import { featureStyle, selectedObservationStyle} from './style.ts';
import { Temporal } from 'temporal-polyfill';
import type { CollectionEvent } from 'ol/Collection.js';
import type { FeatureLike } from 'ol/Feature.js';
import type {Feature as GeoJSONFeature, Point as GeoJSONPoint} from 'geojson';
import type { SightingProperties } from '../types.ts';
import type Point from 'ol/geom/Point.js';
import { classMap } from 'lit/directives/class-map.js';
import KML from 'ol/format/KML.js';
import VectorSource from 'ol/source/Vector.js';

const sphericalMercator = 'EPSG:3857';

const link = new Link({params: ['x', 'y', 'z'], replace: true});
const coordinates = {
  latitude: 47.8,
  longitude: -122.450,
  date: Temporal.Now.plainDateISO('PST8PDT').toString(),
};

const temporalSource = new TemporalFeatureSource(coordinates);
const temporalLayer = new VectorLayer({
  source: temporalSource,
  style: featureStyle,
});

const viewingLocations = new VectorLayer({
  maxResolution: 40,
  source: new VectorSource({
    attributions: 'Sighting Viewpoints by Thorsten Lisker and Alisa Lemire Brooks of Orca Network',
    url: viewingLocationKML,
    format: new KML(),
  }),
});

const select = new Select({
  layers: [temporalLayer],
  filter: (f) => f.get('kind') === 'Sighting',
  multi: false,
  style: selectedObservationStyle,
});
const selection = select.getFeatures();
selection.on('add', (e: CollectionEvent<FeatureLike>) => {
  const id = e.element.getId();
  if (id)
    link.update('s', id as string);
  console.log(e.element.getProperties());
});
selection.on('remove', () => {
  link.update('s', null);
});
const setDate = (date: string) => {
  coordinates.date = date;
  temporalSource.refresh();
  link.update('d', coordinates.date);
};
const initialD = link.track('d', setDate);
if (initialD) {
  setDate(initialD);
}

// This is a thin wrapper around imperative code driving OpenLayers.
// The code is informed by the `openlayers-elements` project, but we avoid taking it as a dependency.
@customElement('obs-map')
export class ObsMap extends LitElement {
  public map?: OpenLayersMap = undefined

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
@media (max-aspect-ratio: 1) {
  :host {
    flex-direction: column;
  }
  obs-panel {
    border-left: 0;
    border-top: 1px solid #cccccc;
  }
}
obs-panel {
  bordeer-left: 1px solid #cccccc;
  border-top: 0;
  flex-basis: 35%;
}
.date {
  font-size: 0.8rem;
  font-style: italic;
  margin-top: 1em;
  text-align: right;
}
  `

  @state()
  private features: GeoJSONFeature<GeoJSONPoint, SightingProperties>[] = [];

  constructor() {
    super();
    temporalSource.on('change', this.updateSightings.bind(this));
    this.addEventListener('focus-observation', (evt) => {
      if (!(evt instanceof CustomEvent) || typeof evt.detail !== 'string')
        throw "oh no";
      this.focusObservation(evt.detail);
    });
    this.addEventListener('date-selected', (evt) => {
      if (!(evt instanceof CustomEvent) || typeof evt.detail !== 'string')
        throw "oh no";
      setDate(evt.detail);
    });
    link.track('s', (v) => v && this.focusObservation(v));
    select.on('select', (e: SelectEvent) => {
      const id = e.selected[0]?.getId() as string | undefined;
      if (id) {
        this.renderRoot.querySelector(`#${id.replace(':', '\\:')}`)?.scrollIntoView({block: 'center'});
      }
    });
  }

  focusObservation(id: string) {
    const feature = temporalSource.getFeatureById(id)!;
    if (!feature)
      return;
    selection.clear();
    selection.push(feature);
    const geometry = feature.getGeometry() as Point;
    this.map!.getView().animate({zoom: 12}, {center: geometry.getCoordinates()});
  }

  // Used by the side panel
  updateSightings() {
    this.features = temporalSource.getFeatures()
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
      });
  }

  public render() {
    const selectedId = selection.getArray()[0]?.getId();
    return html`
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/ol@v10.4.0/ol.css" type="text/css" />
      <div id="map"></div>
      <obs-panel date=${coordinates.date}>
        ${this.features.map(feature => {
          const {id} = feature.properties;
          return html`
            <obs-summary class=${classMap({focused: id === selectedId})} id=${id} .sighting=${feature.properties} />
          `;
        })}
      </obs-panel>
    `;
  }

  public firstUpdated(_changedProperties: PropertyValues): void {
    this.map = new OpenLayersMap({
      interactions: defaultInteractions().extend([link, select]),
      layers: [
        new TileLayer({
          source: new XYZ({
            attributions: 'Esri and its data providers',
            urls: [
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
        viewingLocations,
      ],
      target: this.mapElement,
      view: new View({
        center: fromLonLat([coordinates.longitude, coordinates.latitude]),
        projection: sphericalMercator,
        zoom: 9,
      }),
    });
    this.map.getView().on('change:resolution', console.log);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "obs-map": ObsMap;
  }
}
