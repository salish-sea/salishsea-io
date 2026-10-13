import type { IControl } from "maplibre-gl";
import { locateMeIcon } from "./icons.ts";
import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { geolocationMessage } from "./geolocation-message.ts";

type Options = {
  onLocationUpdated: (coordinates: {longitude: number; latitude: number}) => void;
  onLocationInactive: () => void;
  /**
   * The control is a MapLibre control, not a Lit component, and its
   * element is grafted into the map's control container rather than rendered
   * from a template — so it hands the failure back to `<obs-map>`, which is a
   * component and can report it. The tooltip below still carries the reason for
   * anyone who comes back to the reddened button later.
   */
  onLocationError: (message: string, error: GeolocationPositionError) => void;
};
type State = {
  state: 'inactive'
} | {
  state: 'active';
  watchID: number;
} | {
  state: 'error';
  error: string
};
export default class UserLocationControl implements IControl {
  readonly #container = document.createElement('div');

  constructor({onLocationUpdated, onLocationInactive, onLocationError}: Options) {
    let state: State = {state: 'inactive'};
    const element = document.createElement('user-location-control');
    element.stateObject = state;
    this.#container.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    this.#container.append(element);

    element.addEventListener('click', () => {
      if (state.state === 'active') {
        navigator.geolocation.clearWatch(state.watchID);
        state = element.stateObject = {state: 'inactive'};
        onLocationInactive();
      } else {
        const watchID = navigator.geolocation.watchPosition(({coords}) => {
          onLocationUpdated(coords);
        }, (error) => {
          const message = geolocationMessage(error, 'show your location');
          onLocationError(message, error);
          navigator.geolocation.clearWatch(watchID);
          state = element.stateObject = {state: 'error', error: message};
          onLocationInactive();
        });
        state = element.stateObject = {state: 'active', watchID};
      }
    });
  }

  onAdd() {
    return this.#container;
  }

  onRemove() {
    this.#container.remove();
  }
}

@customElement('user-location-control')
class UserLocationControlElement extends LitElement {
  @property({attribute: true, reflect: true, type: String})
  state!: State['state']

  @property({attribute: true, reflect: true, type: String})
  error: string | undefined

  set stateObject(value: State) {
    this.state = value.state;
    this.error = value.state === 'error' ? value.error : undefined;
    this.className = value.state;
  }

  protected override createRenderRoot() { return this; }

  protected render() {
    const title = this.error ?? 'Show my location';
    return html`
      <button title=${title} type="button">
        <svg class="inline-icon" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${locateMeIcon}</svg>
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "user-location-control": UserLocationControlElement;
  }
}
