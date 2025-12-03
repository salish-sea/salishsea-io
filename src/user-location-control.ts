import Control from "ol/control/Control.js";
import { locateMeIcon } from "./icons.ts";
import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import olCSS from 'ol/ol.css?url';

type SuperOptions = ConstructorParameters<typeof Control>[0];
type Options = SuperOptions & {
  onLocationUpdated: (coordinates: {longitude: number; latitude: number}) => void;
  onLocationInactive: () => void;
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
  constructor({onLocationUpdated, onLocationInactive, ...options}: Options) {
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
          console.error(`Failed to get user location: ${error.message}`);
          navigator.geolocation.clearWatch(watchID);
          state = element.stateObject = {state: 'error', error: error.message};
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
  }

  protected render() {
    const title = this.error ?? 'Show my location';
    return html`
      <link rel="stylesheet" href="${olCSS}" type="text/css" />
      <div class="user-location-control ol-unselectable ol-control ${this.state}">
        <button title=${title} type="button">
          <svg class="inline-icon" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">${locateMeIcon}</svg>
        </button>
      </div>
    `;
  }

  static styles = css`
    svg { fill: currentColor; }
    .error svg { color: red; }
    .active svg { color: rgb(51, 153, 255); }
    .inactive svg { color: var(--ol-subtle-foreground-color) }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "user-location-control": UserLocationControlElement;
  }
}
