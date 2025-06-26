import { css, html, LitElement, type PropertyValues} from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import './obs-map.ts';
import './login-button.ts';
import { type User } from "@auth0/auth0-spa-js";
import { doLogIn, doLogInContext, doLogOut, doLogOutContext, getTokenSilently, getUser, tokenContext, userContext } from "./identity.ts";
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
      flex-direction: column;
      height: 100dvh;
    }
    a {
      text-decoration: none;
    }
    .about-link {
      color: inherit;
      font-size: 1rem;
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
      display: flex;
      flex-direction: row;
      flex-grow: 1;
      overflow: auto;
    }
    dialog {
      max-width: 30rem;
      padding: 0.5rem;
    }
    dialog::backdrop {
      backdrop-filter: blur(0.5rem);
    }
    .close-dialog {
      float: right;
    }
    obs-panel {
      border-left: 1px solid #cccccc;
      border-top: 0;
      padding: 0.5rem;
      width: 25rem;
    }

    @media (max-aspect-ratio: 1) {
      main {
        flex-direction: column;
      }
      obs-map {
        flex-shrink: 0;
        height: 50svh;
      }
      obs-panel {
        border-left: 0;
        border-top: 1px solid #cccccc;
        width: 100%;
      }
    }
  `;

  @provide({context: mapContext})
  olmap: OpenLayersMap | undefined

  @provide({context: drawingSourceContext})
  drawingSource: VectorSource | undefined

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
  map!: ObsMap;

  @query('dialog', true)
  aboutDialog!: HTMLDialogElement;

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
  dbt: number = 0;

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
    this.addEventListener('database-changed', (evt) => {
      if (!(evt instanceof CustomEvent) || typeof evt.detail !== 'number')
        throw "oh no";
      this.dbt = evt.detail;
    });
    this.#refreshTimer = setInterval(() => this.dbt += 1, 1000 * 30);
  }

  disconnectedCallback(): void {
    clearInterval(this.#refreshTimer);
  }

  protected render(): unknown {
    const featureHref = queryStringAppend('/api/temporal-features', {d: this.date, t: this.dbt});
    return html`
      <header>
        <h1>SalishSea.io <a @click=${this.onAboutClicked} class="about-link" href="#" title="About SalishSea.io">&#9432;</a></h1>
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
        <dialog>
          <h3>About SalishSea.io <a @click=${this.onCloseModal} class="close-dialog" href="#">x</a></h3>
          <p>Communities throughout the Salish Sea are working to protect the diversity of life it supports. This site serves as a portal into their efforts.</p>
          <p>We currently show:</p>
          <ul>
            <li><a href="https://www.inaturalist.org/">iNaturalist</a> observations of cetaceans and seals</li>
            <li>Sightings submitted to the <a href="https://www.whalealert.org/">Whale Alert</a> app by the public</li>
            <li>Sightings by the <a href="https://www.orcanetwork.org/">Orca Network</a> community</li>
          </ul>
          <p>If you have any feedback, tap the Feedback button in the top-right of the page, or email <a href="mailto:rainhead@gmail.com">rainhead@gmail.com</a></p>
        </dialog>
        <obs-map date=${this.date} url=${featureHref}></obs-map>
        <obs-panel date=${this.date}>
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
    this.user = await getUser();
    this.token = this.user ? await getTokenSilently() : undefined;
  }

  async doLogIn() {
    await doLogIn();
    await this.updateAuth();
    return !!this.user;
  }

  async doLogOut() {
    await doLogOut();
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

  onAboutClicked(e: Event) {
    e.preventDefault();
    this.aboutDialog.showModal();
  }

  onCloseModal(e: Event) {
    e.preventDefault();
    this.aboutDialog.close();
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
