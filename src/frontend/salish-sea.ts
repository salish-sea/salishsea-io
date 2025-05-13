import { css, html, LitElement, type PropertyValues} from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import './obs-map.ts';
import './login-button.ts';
import { type User } from "@auth0/auth0-spa-js";
import { auth0promise, doLogInContext, doLogOutContext, redirectUri, tokenContext, userContext } from "./identity.ts";
import { provide } from "@lit/context";
import { Temporal } from "temporal-polyfill";
import { queryStringAppend } from "./util.ts";
import type Point from "ol/geom/Point.js";
import type {Feature as GeoJSONFeature, Point as GeoJSONPoint} from 'geojson';
import type { SightingProperties } from "../types.ts";
import { repeat } from "lit/directives/repeat.js";
import { classMap } from "lit/directives/class-map.js";
import type Feature from "ol/Feature.js";
import drawingSourceContext from "./drawing-context.ts";
import type VectorSource from "ol/source/Vector.js";
import type OpenLayersMap from "ol/Map.js";
import mapContext from "./map-context.ts";
import type { ObsMap } from "./obs-map.ts";

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
    obs-panel {
      border-left: 1px solid #cccccc;
      border-top: 0;
      flex-basis: 35%;
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
  `;

  @provide({context: mapContext})
  olmap: OpenLayersMap | undefined

  @provide({context: drawingSourceContext})
  drawingSource: VectorSource | undefined

  @property()
  logIn!: () => Promise<boolean>;

  @property({attribute: 'focused-feature', type: String, reflect: true})
  set focusedSightingId(id: string | undefined) {
    this.#focusedSightingId = id;
    this.focusSighting(id)
  }
  get focusedSightingId() {
    return this.#focusedSightingId;
  }
  #focusedSightingId: string | undefined

  @query('obs-map', true)
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
  date: string

  @property({type: String, reflect: true})
  nonce: string = Temporal.Now.instant().epochMilliseconds.toString();

  #refreshTimer: NodeJS.Timeout

  constructor() {
    super();
    const queryDate = new URLSearchParams(document.location.search).get('d');
    if (queryDate?.match(/^\d\d\d\d-\d\d-\d\d$/)) {
      this.date = queryDate;
    } else {
      this.date = Temporal.Now.plainDateISO('PST8PDT').toString();
    }
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
      if (!(evt instanceof CustomEvent) || typeof evt.detail !== 'string')
        throw "oh no";
      this.nonce = evt.detail;
    });
    this.#refreshTimer = setInterval(() => this.nonce = Temporal.Now.instant().epochMilliseconds.toString(), 1000 * 60);
  }

  disconnectedCallback(): void {
    clearInterval(this.#refreshTimer);
  }

  protected render(): unknown {
    const featureHref = queryStringAppend('/api/temporal-features', {d: this.date, nonce: this.nonce});
    return html`
      <header>
        <h1>SalishSea.io</h1>
        <div>
          <a href="https://orcasound.zulipchat.com/#narrow/channel/494032-salishsea-io/topic/changelog.20and.20feedback/with/508367635">
            <button title="Get help or give feedback" type="button">
              Feedback
            </button>
          </a>
          <login-button></login-button>
        </div>
      </header>
      <main>
        <obs-map date=${this.date} url=${featureHref}></obs-map>
        <obs-panel .logIn=${this.logIn} date=${this.date}>
          ${repeat(this.features, f => f.properties.id, feature => {
            const id = feature.properties.id;
            return html`
              <obs-summary class=${classMap({focused: id === this.focusedSightingId})} ?focused=${id === this.focusedSightingId} id=${id} .sighting=${feature.properties} />
            `;
          })}
        </obs-panel>
      </main>
    `;
  }

  async updateAuth() {
    const auth0 = await auth0promise;
    this.user = await auth0.getUser();
    this.token = this.user ? await auth0.getTokenSilently({authorizationParams: {redirect_uri: redirectUri}}) : undefined;
  }

  async doLogIn() {
    const auth0 = await auth0promise;
    await auth0.loginWithPopup({
      authorizationParams: {
        redirect_uri: redirectUri,
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
    this.olmap = this.map.map;
    this.drawingSource = this.map.drawingSource;
  }

  focusSighting(id: string | undefined) {
    if (!id)
      return;
    const feature = this.map.temporalSource.getFeatureById(id) as Feature<Point> | null;
    if (!feature)
      return;
    this.map.selectFeature(feature);
    this.map.ensureCoordsInViewport(feature.getGeometry()!.getCoordinates());
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
