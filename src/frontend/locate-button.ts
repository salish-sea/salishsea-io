import { html, LitElement, type PropertyValues } from "lit";
import { customElement, state } from "lit/decorators.js";
import Draw, { DrawEvent } from 'ol/interaction/Draw.js';
import mapContext from "./map-context.ts";
import { consume } from "@lit/context";
import type OpenLayersMap from "ol/Map.js";
import type Point from "ol/geom/Point.js";
import { sighterStyle } from "./style.ts";


// TODO: This could maybe be a controller instead, and leave all the rendering to the host.

@customElement('locate-button')
export default class LocateButton extends LitElement {
  @state()
  draw = new Draw({style: sighterStyle, type: 'Point'});

  @consume({context: mapContext})
  map!: OpenLayersMap

  protected render() {
    return html`
      <button @click=${this.onClick} type="button" name="locate">📍</button>
    `;
  }

  onClick () {
    this.map.addInteraction(this.draw);
  }

  onDrawEnd(e: DrawEvent) {
    const placeholder = e.feature.getGeometry() as Point;
    const coordinates = placeholder.getCoordinates();
    this.map.removeInteraction(this.draw);
    const event = new CustomEvent('coordinates-selected', {bubbles: true, composed: true, detail: coordinates});
    this.dispatchEvent(event);
  }

  protected firstUpdated(_changedProperties: PropertyValues): void {
    this.draw.on('drawend', this.onDrawEnd.bind(this));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "locate-button": LocateButton;
  }
}
