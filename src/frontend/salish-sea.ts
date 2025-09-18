import { css, html, LitElement, type PropertyValues} from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import './obs-map.ts';
import './login-button.ts';
import { userContext, type User } from "./identity.ts";
import { provide } from "@lit/context";
import { Temporal } from "temporal-polyfill";
import type Point from "ol/geom/Point.js";
import { repeat } from "lit/directives/repeat.js";
import { classMap } from "lit/directives/class-map.js";
import type Feature from "ol/Feature.js";
import drawingSourceContext from "./drawing-context.ts";
import type VectorSource from "ol/source/Vector.js";
import type OpenLayersMap from "ol/Map.js";
import mapContext from "./map-context.ts";
import type { MapMoveDetail, ObsMap } from "./obs-map.ts";
// import * as Sentry from "@sentry/browser";
import type { CloneSightingEvent } from "./obs-summary.ts";
import { occurrence2feature } from "../occurrence.ts";
import { supabase, type Occurrence } from "./supabase.ts";

// Sentry.init({
//   dsn: "https://56ce99ce80994bab79dab62d06078c97@o4509634382331904.ingest.us.sentry.io/4509634387509248",
//   // Setting this option to true will send default PII data to Sentry.
//   // For example, automatic IP address collection on events
//   sendDefaultPii: true,
//   integrations: [
//     Sentry.feedbackIntegration({
//       colorScheme: "system",
//       formTitle: "Report a Bug or Give Feedback",
//       isNameRequired: true,
//       successMessageText: "Thank you for taking the time to let us know.",
//       triggerLabel: "Report Bug or Give Feedback",
//     }),
//   ]
// });

const dateRE = /^(\d\d\d\d-\d\d-\d\d)$/;
const initialSearchParams = new URLSearchParams(document.location.search);
const initialQueryDate = initialSearchParams.get('d');
const initialDate = dateRE.test(initialQueryDate || '') && initialQueryDate || Temporal.Now.plainDateISO('PST8PDT').toString();
const initialX = parseFloat(initialSearchParams.get('x') || '-13631071');
const initialY = parseFloat(initialSearchParams.get('y') || '6073646');
const initialZ = parseFloat(initialSearchParams.get('z') || '9');

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
      padding: 0.5rem;
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
      padding: 0.5rem 0.5rem 5.5rem 0.5rem;
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
        flex-grow: 1;
        min-height: 0;
        overflow: auto;
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

  // SightingForm needs access to the map to add and remove interactions
  @query('obs-map', true)
  map!: ObsMap;

  @query('dialog', true)
  aboutDialog!: HTMLDialogElement;

  @provide({context: userContext})
  @state()
  protected user: User | null = null;

  #date: string = initialDate
  @property({type: String, reflect: true})
  get date() { return this.#date }
  set date(d: string) {
    if (d === this.#date)
      return;
    this.#date = d;
    this.fetchOccurrences(d);
    setQueryParams({d});
  }

  @property({attribute: false})
  private sightings: Occurrence[] = []

  constructor() {
    super();
    this.updateUser();
    this.addEventListener('log-in', this.doLogIn.bind(this));
    this.addEventListener('log-out', this.doLogOut.bind(this));
    this.addEventListener('focus-sighting', evt => {
      const e = evt as CustomEvent<string | undefined>;
      this.focusedSightingId = e.detail;
    });
    this.addEventListener('date-selected', (evt) => {
      if (!(evt instanceof CustomEvent) || typeof evt.detail !== 'string')
        throw "oh no";
      this.date = evt.detail;
    });
    this.addEventListener('map-move', (evt) => {
      const {center: [x, y], zoom} = (evt as CustomEvent<MapMoveDetail>).detail;
      setQueryParams({x: x.toFixed(), y: y.toFixed(), z: zoom.toFixed()});
    });
    this.addEventListener('sighting-saved', (evt) => {
      const id = (evt as CustomEvent<string>).detail;
      this.focusedSightingId = id;
    });
    this.addEventListener('clone-sighting', async (evt) => {
      const sighting = (evt as CloneSightingEvent).detail;
      await this.shadowRoot!.querySelector('obs-panel')!.editSighting(sighting);
    });
    this.addEventListener('database-changed', async () => {
      await this.fetchOccurrences(this.date);
    });
  }

  protected render(): unknown {
    return html`
      <header>
        <h1>SalishSea.io <a @click=${this.onAboutClicked} class="about-link" href="#" title="About SalishSea.io">&#9432;</a></h1>
        <div>
          <login-button></login-button>
        </div>
      </header>
      <main>
        <dialog>
          <h3>About SalishSea.io <a @click=${this.onCloseModal} class="close-dialog" href="#">x</a></h3>
          <p>A project of <a href="https://beamreach.blue/">Beam Reach</a>.</p>
          <p>Communities throughout the Salish Sea are working to protect the diversity of life it supports. This site serves as a portal into their efforts.</p>
          <p>We currently show:</p>
          <ul>
            <li><a href="https://www.inaturalist.org/">iNaturalist</a> observations of cetaceans and seals</li>
            <li>Sightings submitted to the <a href="https://www.whalealert.org/">Whale Alert</a> app by the public</li>
            <li>Sightings by the <a href="https://www.orcanetwork.org/">Orca Network</a> community</li>
          </ul>
          <p>If you have any feedback, tap the Feedback button in the top-right of the page, or email <a href="mailto:rainhead@gmail.com">rainhead@gmail.com</a></p>
        </dialog>
        <obs-map centerX=${initialX} centerY=${initialY} zoom=${initialZ}></obs-map>
        <obs-panel date=${this.date}>
          ${repeat(this.sightings, sighting => sighting.id, (sighting) => {
            const id = sighting.id;
            const classes = {focused: id === this.focusedSightingId};
            return html`
              <obs-summary class=${classMap(classes)} id=${`summary-${id}`} ?focused=${id === this.focusedSightingId} .sighting=${sighting} />
            `;
          })}
        </obs-panel>
      </main>
    `;
  }

  doLogIn() {
    google.accounts.id.prompt();
  }

  async doLogOut() {
    supabase.auth.signOut();
    this.user = null;
    await this.fetchOccurrences(this.date);
  }

  public async receiveIdToken(token: string) {
    await supabase.auth.signInWithIdToken({'provider': 'google', token});
    await this.updateUser();
  }

  private async updateUser() {
    const {data, error} = await supabase.auth.getUser();
    if (error) {
      console.error(error);
    } else {
      this.user = data.user;
      await this.fetchOccurrences(this.date);
    }
  }

  protected firstUpdated(_changedProperties: PropertyValues): void {
    this.olmap = this.map.map;
    this.drawingSource = this.map.drawingSource;
  }

  receiveSightings(sightings: Occurrence[], forDate: string) {
    if (forDate !== this.date)
      return;
    this.sightings = sightings;
    const features = sightings.map(occurrence2feature);
    this.map.setFeatures(features);
  }

  focusSighting(id: string | undefined) {
    if (!id)
      return;
    const feature = this.map.presenceSource.getFeatureById(id) as Feature<Point> | null;
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

  async fetchOccurrences(date: string) {
    const {data, error} = await supabase.from('occurrences').select().eq('local_date', this.date);
    if (error)
      return Promise.reject(error);
    if (!data)
      return Promise.reject(new Error("Got empty response from presence_on_date"));

    this.receiveSightings(data as Occurrence[], date);
  }
}

function setQueryParams(params: {[k: string]: string}) {
    const url = new URL(window.location.href);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    window.history.pushState({}, '', url.toString());
}


declare global {
  interface HTMLElementTagNameMap {
    "salish-sea": SalishSea;
  }
}
