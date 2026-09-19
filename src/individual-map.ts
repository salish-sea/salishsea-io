import { css, html, LitElement, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { createRef, ref } from 'lit/directives/ref.js';
import OpenLayersMap from 'ol/Map.js';
import View from 'ol/View.js';
import TileLayer from 'ol/layer/Tile.js';
import XYZ from 'ol/source/XYZ.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorSource from 'ol/source/Vector.js';
import Feature from 'ol/Feature.js';
import Point from 'ol/geom/Point.js';
import { circular } from 'ol/geom/Polygon.js';
import type Geometry from 'ol/geom/Geometry.js';
import { fromLonLat } from 'ol/proj.js';
import { defaults as defaultControls } from 'ol/control/defaults.js';
import CircleStyle from 'ol/style/Circle.js';
import Fill from 'ol/style/Fill.js';
import Stroke from 'ol/style/Stroke.js';
import Style from 'ol/style/Style.js';
import olCSS from 'ol/ol.css?url';
import { mapUrl, type OccurrenceLink } from './catalog.ts';

// What a dot needs: where, when, and which occurrence to open on the main map.
export type MapDot = Pick<OccurrenceLink, 'occurrence_id' | 'observed_at' | 'location'>;

// A place the dots are measured against (a haul-out site): its point and the
// radius within which a report counts (decision 040).
export interface MapSite {
  lon: number;
  lat: number;
  radius_m: number;
}

const dotStyle = new Style({
  image: new CircleStyle({
    radius: 5,
    fill: new Fill({ color: 'rgba(25, 118, 210, 0.55)' }),
    stroke: new Stroke({ color: '#ffffff', width: 1 }),
  }),
});

const siteStyle = new Style({
  fill: new Fill({ color: 'rgba(230, 81, 0, 0.10)' }),
  stroke: new Stroke({ color: 'rgba(230, 81, 0, 0.8)', width: 1.5, lineDash: [6, 4] }),
});

const siteCentreStyle = new Style({
  image: new CircleStyle({
    radius: 4,
    fill: new Fill({ color: '#e65100' }),
    stroke: new Stroke({ color: '#ffffff', width: 1 }),
  }),
  zIndex: 2,
});

const latestStyle = new Style({
  image: new CircleStyle({
    radius: 7,
    fill: new Fill({ color: '#1565c0' }),
    stroke: new Stroke({ color: '#ffffff', width: 2 }),
  }),
  zIndex: 1,
});

// A non-panning, non-zooming map of everywhere an individual has been
// reported; the most recent report is emphasized. Clicking a dot opens the
// main map on that day, focused on the occurrence. Given a site, it also draws
// the site's radius and zooms in close enough to see it.
@customElement('individual-map')
export class IndividualMap extends LitElement {
  // Newest first, as returned by fetchOccurrenceLinks
  @property({ attribute: false })
  links: MapDot[] = [];

  @property({ attribute: false })
  site: MapSite | null = null;

  #mapRef = createRef<HTMLDivElement>();
  #map: OpenLayersMap | null = null;
  #source = new VectorSource<Feature<Geometry>>();

  static styles = css`
    :host {
      display: block;
    }
    #map {
      border: 1px solid #e2e8f0;
      height: 24rem;
      width: 100%;
    }
  `;

  render() {
    return html`
      <link rel="stylesheet" href="${olCSS}" type="text/css" />
      <div id="map" ${ref(this.#mapRef)}></div>
    `;
  }

  protected firstUpdated(): void {
    this.#map = new OpenLayersMap({
      target: this.#mapRef.value!,
      interactions: [],
      controls: defaultControls({ zoom: false, rotate: false }),
      layers: [
        new TileLayer({
          source: new XYZ({
            attributions: 'Base map by Esri and its data providers',
            urls: [
              'https://services.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
              'https://server.arcgisonline.com/arcgis/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
            ],
          }),
        }),
        new VectorLayer({ source: this.#source }),
      ],
      view: new View({ center: fromLonLat([-123.2, 48.5]), zoom: 7 }),
    });
    this.#map.on('singleclick', evt => {
      const feature = this.#map!.forEachFeatureAtPixel(evt.pixel, f => f, { hitTolerance: 4 });
      const href = feature?.get('href') as string | undefined;
      if (href) window.location.href = href;
    });
    this.#map.on('pointermove', evt => {
      const hit = this.#map!.hasFeatureAtPixel(evt.pixel, { hitTolerance: 4 });
      this.#mapRef.value!.style.cursor = hit ? 'pointer' : '';
    });
    this.#renderLinks();
  }

  protected updated(changed: PropertyValues): void {
    if ((changed.has('links') || changed.has('site')) && this.#map)
      this.#renderLinks();
  }

  #renderLinks(): void {
    this.#source.clear();
    const located = this.links.filter(link => link.location);
    this.#source.addFeatures(located.map((link, i) => {
      const feature = new Feature(new Point(fromLonLat([link.location!.lon, link.location!.lat])));
      feature.set('href', mapUrl(link));
      feature.setStyle(i === 0 ? latestStyle : dotStyle);
      return feature;
    }));
    if (this.site) {
      const ring = new Feature(circular([this.site.lon, this.site.lat], this.site.radius_m, 64).transform('EPSG:4326', 'EPSG:3857'));
      ring.setStyle(siteStyle);
      const centre = new Feature(new Point(fromLonLat([this.site.lon, this.site.lat])));
      centre.setStyle(siteCentreStyle);
      this.#source.addFeatures([ring, centre]);
    }
    const extent = this.#source.getExtent();
    if ((!located.length && !this.site) || !extent) return;
    this.#map!.getView().fit(extent, {
      padding: [32, 32, 32, 32],
      maxZoom: this.site ? 15 : 10,
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'individual-map': IndividualMap;
  }
}
