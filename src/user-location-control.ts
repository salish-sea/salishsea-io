import Control from "ol/control/Control.js";
import { locateMeIcon } from "./icons.ts";
import { html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { geolocationMessage } from "./geolocation-message.ts";

type SuperOptions = ConstructorParameters<typeof Control>[0];
type Options = SuperOptions & {
  onLocationUpdated: (coordinates: {longitude: number; latitude: number}) => void;
  onLocationInactive: () => void;
  /**
   * The control is an OpenLayers `Control`, not a Lit component, and its
   * element is grafted into the map's overlay container rather than rendered
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
export default class UserLocationControl extends Control {
  constructor({onLocationUpdated, onLocationInactive, onLocationError, ...options}: Options) {
    let state: State = {state: 'inactive'};
    const element = document.createElement('user-location-control');
    element.stateObject = state;

    super({element, ...options})

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
    this.className = `ol-unselectable ol-control ${value.state}`;
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
