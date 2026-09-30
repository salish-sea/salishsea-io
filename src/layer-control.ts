import Control from "ol/control/Control.js";
import { html, LitElement, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { layersIcon } from "./icons.ts";
import { REFERENCE_LAYERS, type ReferenceLayer } from "./reference-layers.ts";
import { HAULOUT_COLOR } from "./style.ts";
import hydrophoneIcon from './assets/hydrophone-default.svg?url';
import salmonCountingSiteIcon from './assets/salmon-counting-site.svg?url';
import viewingLocationIcon from './assets/viewing-location.svg?url';

type Options = {
  visible: ReadonlySet<ReferenceLayer>;
  onChange: (visible: Set<ReferenceLayer>) => void;
};

/**
 * The switch for the map's reference layers (GH #453, decision 058): a button
 * in the map's top-right corner that opens a checkbox per layer. Each row shows
 * the layer's own marker, so the menu is also the legend.
 *
 * Like the location control, an OpenLayers `Control` whose element is grafted
 * into the map, so it sits with the zoom buttons and takes their styling. It
 * holds no state of its own beyond whether it is open: `<obs-map>` sets which
 * layers are visible, and a change goes back up through `onChange`.
 */
export default class LayerControl extends Control {
  readonly #element: LayerControlElement;

  constructor({visible, onChange}: Options) {
    const element = document.createElement('layer-control');
    element.className = 'ol-unselectable ol-control';
    element.visible = visible;
    element.onChange = onChange;
    super({element});
    this.#element = element;
  }

  set visible(visible: ReadonlySet<ReferenceLayer>) {
    this.#element.visible = visible;
  }
}

const markers: Record<ReferenceLayer, unknown> = {
  viewpoints: html`<img src=${viewingLocationIcon} alt="">`,
  hydrophones: html`<img src=${hydrophoneIcon} alt="">`,
  salmon: html`<img src=${salmonCountingSiteIcon} alt="">`,
  haulouts: html`<svg viewBox="0 0 16 16" aria-hidden="true">${svg`<path d="M8 2 14 8 8 14 2 8Z" fill="white" stroke=${HAULOUT_COLOR} stroke-width="2"/>`}</svg>`,
};

@customElement('layer-control')
class LayerControlElement extends LitElement {
  @property({attribute: false})
  visible: ReadonlySet<ReferenceLayer> = new Set();

  onChange: (visible: Set<ReferenceLayer>) => void = () => {};

  @state()
  private open = false;

  protected override createRenderRoot() { return this; }

  // Closes on a press anywhere else, or Escape. composedPath() sees through
  // the map's shadow root, which the event's target does not.
  //
  // A press on the map while the menu is open only closes it. Tapping the map
  // is how a phone dismisses a menu, and with haul-outs on, that tap would
  // otherwise land on a site and leave the page. Listening in the capture
  // phase is what lets it stop the press before OpenLayers sees it.
  #onDocumentPointerDown = (e: PointerEvent) => {
    if (!this.open)
      return;
    const path = e.composedPath();
    if (path.includes(this))
      return;
    this.open = false;
    const viewport = this.closest('.ol-viewport');
    if (viewport && path.includes(viewport)) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  #onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.open) {
      this.open = false;
      this.querySelector('button')?.focus();
    }
  };

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener('pointerdown', this.#onDocumentPointerDown, {capture: true});
    this.addEventListener('keydown', this.#onKeyDown);
  }

  override disconnectedCallback() {
    document.removeEventListener('pointerdown', this.#onDocumentPointerDown, {capture: true});
    this.removeEventListener('keydown', this.#onKeyDown);
    super.disconnectedCallback();
  }

  #toggle(layer: ReferenceLayer, on: boolean) {
    const visible = new Set(this.visible);
    if (on) visible.add(layer); else visible.delete(layer);
    this.onChange(visible);
  }

  protected render() {
    return html`
      <button type="button" title="Map layers" aria-label="Map layers"
          aria-expanded=${this.open ? 'true' : 'false'} aria-controls="layer-menu"
          @click=${() => this.open = !this.open}>
        <svg class="inline-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${layersIcon}</svg>
      </button>
      ${this.open ? html`
        <fieldset id="layer-menu" class="layer-menu">
          <legend>Map layers</legend>
          ${REFERENCE_LAYERS.map(({id, label}) => html`
            <label>
              <input type="checkbox" .checked=${this.visible.has(id)}
                  @change=${(e: Event) => this.#toggle(id, (e.target as HTMLInputElement).checked)}>
              <span class="marker">${markers[id]}</span>
              ${label}
            </label>
          `)}
        </fieldset>
      ` : ''}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "layer-control": LayerControlElement;
  }
}
