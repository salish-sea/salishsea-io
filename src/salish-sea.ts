import { css, html, LitElement, type PropertyValues} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import './obs-map.ts';
import './login-button.ts';
import { userContext, type User } from "./identity.ts";
import { provide } from "@lit/context";
import { Temporal } from "temporal-polyfill";
import { repeat } from "lit/directives/repeat.js";
import { classMap } from "lit/directives/class-map.js";
import drawingSourceContext from "./drawing-context.ts";
import type VectorSource from "ol/source/Vector.js";
import type OpenLayersMap from "ol/Map.js";
import mapContext from "./map-context.ts";
import type { MapMoveDetail, ObsMap } from "./obs-map.ts";
import type { CloneSightingEvent, EditSightingEvent } from "./obs-summary.ts";
import { fetchLastOwnOccurrence } from "./occurrence.ts";
import { supabase, type Occurrence } from "./supabase.ts";
import { sentryClient } from "./sentry.ts";
import { v7 } from "uuid";
import type { Extent } from "ol/extent.js";
import { isExtent } from "./constants.ts";
import { ObsPanel } from "./obs-panel.ts";
import { createRef, ref } from "lit/directives/ref.js";

if (import.meta.env.PROD)
  sentryClient.init();

const viewInitiallySmall = window.innerWidth < 800;

const dateRE = /^(\d\d\d\d-\d\d-\d\d)$/;

function parseUrlParams(searchParams: URLSearchParams) {
  const dateParam = searchParams.get('d');
  const date = dateParam && dateRE.test(dateParam)
    ? dateParam
    : Temporal.Now.plainDateISO('PST8PDT').toString();

  const x = parseFloat(searchParams.get('x') || '');
  const y = parseFloat(searchParams.get('y') || '');
  const z = parseFloat(searchParams.get('z') || '');

  const hasValidMapPosition = !isNaN(x) && !isNaN(y) && !isNaN(z);

  const occurrenceId = searchParams.get('o') || null;

  return {
    date,
    occurrenceId,
    mapPosition: hasValidMapPosition
      ? { x, y, z }
      : {
          x: viewInitiallySmall ? -13732579 : -13880076,
          y: viewInitiallySmall ? 6095660 : 6211076,
          z: viewInitiallySmall ? 7 : 8
        }
  };
}

const initialParams = parseUrlParams(new URLSearchParams(document.location.search));
const initialDate = initialParams.date;
const initialOccurrenceId = initialParams.occurrenceId;
const initialX = initialParams.mapPosition.x;
const initialY = initialParams.mapPosition.y;
const initialZ = initialParams.mapPosition.z;

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

  #isRestoringFromHistory = false
  #mapMoveDebounceTimer: ReturnType<typeof setTimeout> | null = null

  @property({attribute: false})
  private focusedOccurrenceId: string | null = initialOccurrenceId;

  private dialogRef = createRef<HTMLDialogElement>();
  private mapRef = createRef<ObsMap>();
  private panelRef = createRef<ObsPanel>();

  @state()
  private lastOwnOccurrence: Occurrence | null = null;

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
    if (!this.#isRestoringFromHistory) {
      setQueryParams({d});
    }
  }

  @property({attribute: false})
  private sightings: Occurrence[] = []

  #handlePopState = () => {
    this.#isRestoringFromHistory = true;
    if (this.#mapMoveDebounceTimer) {
      clearTimeout(this.#mapMoveDebounceTimer);
      this.#mapMoveDebounceTimer = null;
    }
    try {
      const params = parseUrlParams(new URLSearchParams(window.location.search));

      // Update date
      this.date = params.date;

      // Update focused occurrence
      this.focusedOccurrenceId = params.occurrenceId;

      // Update map position
      this.mapRef.value?.setView(
        params.mapPosition.x,
        params.mapPosition.y,
        params.mapPosition.z,
        {skipEvent: true}
      );
    } finally {
      this.#isRestoringFromHistory = false;
    }
  };

  constructor() {
    super();
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        this.user = session?.user || null;
      } else if (event === 'SIGNED_OUT') {
        this.user = null;
      }
      this.fetchOccurrences(this.date).catch(err => console.error(err));
      if (this.user)
        fetchLastOwnOccurrence().then(occurrence => this.lastOwnOccurrence = occurrence);
      else
        this.lastOwnOccurrence = null;
    });
    this.addEventListener('log-in', this.doLogIn.bind(this));
    this.addEventListener('log-out', this.doLogOut.bind(this));
    this.addEventListener('focus-occurrence', evt => {
      const occurrence = (evt as CustomEvent<Occurrence | null>).detail;
      this.focusOccurrence(occurrence);
    });
    this.addEventListener('date-selected', (evt) => {
      if (!(evt instanceof CustomEvent) || typeof evt.detail !== 'string')
        throw "oh no";
      this.date = evt.detail;
    });
    this.addEventListener('go-to-extent', (evt) => {
      const extent = (evt as CustomEvent<Extent>).detail;
      if (!isExtent(extent))
        throw new Error(`Invalid extent: ${extent}`);
      this.mapRef.value!.zoomToExtent(extent);
    });
    this.addEventListener('map-move', (evt) => {
      if (this.#isRestoringFromHistory)
        return;

      const {center: [x, y], zoom} = (evt as CustomEvent<MapMoveDetail>).detail;

      // Debounce map updates to avoid spamming history
      if (this.#mapMoveDebounceTimer)
        clearTimeout(this.#mapMoveDebounceTimer);

      this.#mapMoveDebounceTimer = setTimeout(() => {
        setQueryParams({x: x.toFixed(), y: y.toFixed(), z: zoom.toFixed()}, {replace: true});
        this.#mapMoveDebounceTimer = null;
      }, 500);
    });
    this.addEventListener('sighting-saved', (evt) => {
      const occurrence = (evt as CustomEvent<Occurrence>).detail;
      this.focusOccurrence(occurrence);
    });
    this.addEventListener('clone-sighting', async (evt) => {
      const sighting = (evt as CloneSightingEvent).detail;
      const clone = {...sighting, id: v7()};
      await this.panelRef.value!.editObservation(clone);
    });
    this.addEventListener('edit-observation', async (evt) => {
      const sighting = (evt as EditSightingEvent).detail;
      await this.panelRef.value!.editObservation(sighting);
    });
    this.addEventListener('database-changed', async () => {
      await this.fetchOccurrences(this.date);
      this.lastOwnOccurrence = this.user && await fetchLastOwnOccurrence();
    });
  }

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    window.addEventListener('popstate', this.#handlePopState);
    // If any credentials arrived before the component was defined, process them now.
    let token: string | undefined;
    while (token = window.__pendingGSIResponses?.shift()) {
      await this.receiveIdToken(token);
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('popstate', this.#handlePopState);
    if (this.#mapMoveDebounceTimer) {
      clearTimeout(this.#mapMoveDebounceTimer);
    }
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
        <dialog ${ref(this.dialogRef)}>
          <h3>About SalishSea.io <a @click=${this.onCloseModal} class="close-dialog" href="#">x</a></h3>
          <p>Communities throughout the Salish Sea are working to monitor and protect the diversity of life it supports. This site serves as a portal into their efforts.</p>
          <p>We currently show:</p>
          <ul>
            <li><a href="https://www.inaturalist.org/">iNaturalist</a> observations of cetaceans and pinnipeds</li>
            <li>Sightings submitted to the <a href="https://www.whalealert.org/">Whale Alert</a> mobile app by the public</li>
            <li>Sightings from the <a href="https://www.orcanetwork.org/">Orca Network</a> community</li>
            <li>Observations of humpbacks within the Salish Sea from <a href="https://happywhale.com">HappyWhale</a> (open data, 2012-April,2025)</li>
          </ul>
          <p>
            If you have any feedback, tap the Feedback button in the bottom-right of the page, or email <a href="mailto:rainhead@gmail.com">rainhead@gmail.com</a>.
            This free, open access, site is based on <a href="https://github.com/salish-sea/salishsea-io">open source code</a> pioneered by Peter Abrahamsen
            and is funded in 2025-26 by <a href="https://beamreach.blue/">Beam Reach</a>.
          </p>
        </dialog>
        <obs-map ${ref(this.mapRef)} centerX=${initialX} centerY=${initialY} zoom=${initialZ} focusedOccurrenceId=${this.focusedOccurrenceId}></obs-map>
        <obs-panel ${ref(this.panelRef)} date=${this.date} .lastOwnOccurrence=${this.lastOwnOccurrence}>
          ${repeat(this.sightings, sighting => sighting.id, (sighting) => {
            const id = sighting.id;
            const classes = {focused: id === this.focusedOccurrenceId};
            return html`
              <obs-summary class=${classMap(classes)} id=${`summary-${id}`} ?focused=${classes.focused} .sighting=${sighting} />
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
    await this.fetchOccurrences(this.date);
  }

  public async receiveIdToken(token: string) {
    await supabase.auth.signInWithIdToken({'provider': 'google', token});
  }

  protected firstUpdated(_changedProperties: PropertyValues): void {
    this.olmap = this.mapRef.value!.map;
    this.drawingSource = this.mapRef.value!.drawingSource;
  }

  receiveOccurrences(occurrences: Occurrence[], forDate: string) {
    if (forDate !== this.date)
      return;
    this.sightings = occurrences;
    this.mapRef.value!.setOccurrences(occurrences);
  }

  focusOccurrence(occurrence: Occurrence | null) {
    this.focusedOccurrenceId = occurrence?.id || null;
    if (occurrence)
      this.date = Temporal.Instant.from(occurrence.observed_at).toZonedDateTimeISO('PST8PDT').toPlainDate().toString();

    if (!this.#isRestoringFromHistory) {
      if (this.focusedOccurrenceId) {
        setQueryParams({o: this.focusedOccurrenceId});
      } else {
        removeQueryParam('o');
      }
    }
  }

  onAboutClicked(e: Event) {
    e.preventDefault();
    this.dialogRef.value!.showModal();
  }

  onCloseModal(e: Event) {
    e.preventDefault();
    this.dialogRef.value!.close();
  }

  async fetchOccurrences(date: string) {
    const {data, error} = await supabase
      .from('occurrences')
      .select()
      .eq('local_date', this.date)
      .order('observed_at', {ascending: false});
    if (error)
      return Promise.reject(error);
    if (!data)
      return Promise.reject(new Error("Got empty response from presence_on_date"));

    const occurrences = data.map(record => ({
      observed_at_ms: Date.parse(record.observed_at),
      ...record,
    }));

    this.receiveOccurrences(occurrences as Occurrence[], date);
  }
}

function setQueryParams(params: {[k: string]: string}, options: {replace?: boolean} = {}) {
    const url = new URL(window.location.href);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    if (options.replace) {
      window.history.replaceState({}, '', url.toString());
    } else {
      window.history.pushState({}, '', url.toString());
    }
}

function removeQueryParam(key: string) {
    const url = new URL(window.location.href);
    url.searchParams.delete(key);
    window.history.pushState({}, '', url.toString());
}


declare global {
  interface HTMLElementTagNameMap {
    "salish-sea": SalishSea;
  }
  interface Window {
    __pendingGSIResponses?: string[];
  }
}
