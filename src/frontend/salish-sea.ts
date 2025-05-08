import { css, html, LitElement, type PropertyValues} from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import './obs-map.ts';
import './login-button.ts';
import { type User } from "@auth0/auth0-spa-js";
import { auth0promise, doLogInContext, doLogOutContext, tokenContext, userContext } from "./identity.ts";
import { provide } from "@lit/context";
import { Temporal } from "temporal-polyfill";
import { queryStringAppend } from "./util.ts";
import type Point from "ol/geom/Point.js";
import type {Feature as GeoJSONFeature, Point as GeoJSONPoint} from 'geojson';
import type { SightingProperties } from "../types.ts";
import { repeat } from "lit/directives/repeat.js";
import { classMap } from "lit/directives/class-map.js";
import type { ObsMap } from "./obs-map.ts";
import type Feature from "ol/Feature.js";
import drawingSourceContext from "./drawing-context.ts";
import type VectorSource from "ol/source/Vector.js";

@customElement('salish-sea')
export default class SalishSea extends LitElement {
  static styles = css`
    :host {
      display: flex;
      align-content: stretch;
      align-items: stretch;
      flex-direction: column;
      height: 100vh;
    }

    header {
      align-items: baseline;
      background-color: rgb(8, 13, 38);
      box-sizing: border-box;
      color: white;
      display: flex;
      justify-content: space-between;
      padding: 1em;
      width: 100%;
    }

    h1 {
      font-size: 1.2rem;
      margin: 0;
    }

    main {
      align-items: stretch;
      display: flex;
      flex-direction: row;
      flex-grow: 1;
      overflow: auto;
    }

    @media (max-aspect-ratio: 1) {
      main {
        flex-direction: column;
      }
      obs-map {
        flex-grow: 1;
      }
      obs-panel {
        border-left: 0;
        border-top: 1px solid #cccccc;
      }
    }
    obs-panel {
      border-left: 1px solid #cccccc;
      border-top: 0;
      flex-basis: 35%;
    }
  `;

  @provide({context: drawingSourceContext})
  drawingSource: VectorSource | undefined

  @property()
  logIn!: () => Promise<boolean>;

  @property({type: Boolean, reflect: true})
  loggedIn: boolean = false

  @property({attribute: 'focused-feature', type: String, reflect: true})
  set focusedSightingId(id: string | undefined) {
    this.#focusedSightingId = id;
    this.focusSighting(id)
  }
  get focusedSightingId() {
    return this.#focusedSightingId;
  }
  #focusedSightingId: string | undefined

  @query('obs-map')
  map!: ObsMap

  @state()
  private features: GeoJSONFeature<GeoJSONPoint, SightingProperties>[] = [];

  @provide({context: userContext})
  @state()
  protected user: User | undefined;

  @provide({context: tokenContext})
  @state()
  protected token: string | undefined;

  @provide({context: doLogInContext})
  _doLogIn: () => Promise<boolean>

  @provide({context: doLogOutContext})
  _doLogOut: () => Promise<void>

  @property({type: String, reflect: true})
  date: string = Temporal.Now.plainDateISO('PST8PDT').toString()

  @property({type: String, reflect: true})
  nonce: string = Temporal.Now.instant().epochMilliseconds.toString();

  constructor() {
    super();
    this._doLogIn = this.doLogIn.bind(this);
    this._doLogOut = this.doLogOut.bind(this);
    this.updateAuth();
    this.addEventListener('log-in', this.doLogIn.bind(this));
    this.addEventListener('log-out', this.doLogOut.bind(this));
    this.addEventListener('focus-sighting', evt => {
      const e = evt as CustomEvent<string | undefined>;
      this.focusedSightingId = e.detail;
    });
    this.addEventListener('sightings-changed', evt => {
      const e = evt as CustomEvent<Feature<Point>[]>;
      this.updateSightings(e.detail);
    });
    this.addEventListener('date-selected', (evt) => {
      if (!(evt instanceof CustomEvent) || typeof evt.detail !== 'string')
        throw "oh no";
      this.date = evt.detail;
    });
    this.addEventListener('observation-created', (evt) => {
      if (!(evt instanceof CustomEvent) || typeof evt.detail !== 'object')
        throw "oh no";
      const {id}: {id: string} = evt.detail;
      this.nonce = id;
    });
  }

  protected render(): unknown {
    const featureHref = queryStringAppend('/api/temporal-features', {d: this.date, nonce: this.nonce});
    return html`
      <header>
        <h1>SalishSea.io</h1>
        <login-button></login-button>
      </header>
      <main>
        <obs-map date=${this.date} url=${featureHref} focusedSightingId=${this.#focusedSightingId}></obs-map>
        <obs-panel .logIn=${this.logIn} ?loggedIn=${this.loggedIn} date=${this.date}>
          ${repeat(this.features, f => f.properties.id, feature => {
            const id = feature.properties.id;
            return html`
              <obs-summary class=${classMap({focused: id === this.#focusedSightingId})} id=${id} .sighting=${feature.properties} />
            `;
          })}
        </obs-panel>
      </main>
    `;
  }

  async updateAuth() {
    const auth0 = await auth0promise;
    this.user = await auth0.getUser();
    this.token = this.user ? await auth0.getTokenSilently() : undefined;
  }

  async doLogIn() {
    const auth0 = await auth0promise;
    await auth0.loginWithPopup({
      authorizationParams: {
        redirect_uri: new URL('/auth_redirect.html', window.location.href).toString(),
      }
    });
    await this.updateAuth();
    return !!this.user;
  }

  async doLogOut() {
    const auth0 = await auth0promise;
    await auth0.logout({openUrl: false});
    await this.updateAuth();
  }

  protected firstUpdated(_changedProperties: PropertyValues): void {
    this.drawingSource = this.map.drawingSource;
  }

  focusSighting(id: string | undefined) {
    if (!id)
      return;
    const feature = this.map.temporalSource.getFeatureById(id)
    if (!feature)
      return;
    this.map.selectFeature(feature);
  }

  // Used by the side panel
  updateSightings(features: Feature<Point>[]) {
    this.features = features
      .filter(feature => feature.get('kind') === 'Sighting')
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
}


declare global {
  interface HTMLElementTagNameMap {
    "salish-sea": SalishSea;
  }
}
