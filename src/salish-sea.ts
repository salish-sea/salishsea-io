/// <reference types="google.accounts" />
import { css, html, LitElement, type PropertyValues} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import './obs-map.ts';
import './login-button.ts';
import { contributorContext, getContributor, userContext, type User } from "./identity.ts";
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
import { supabase } from "./supabase.ts";
import { sentryClient } from "./sentry.ts";
import { v7 } from "uuid";
import type { Extent } from "ol/extent.js";
import { fromLonLat } from 'ol/proj.js';
import { DEFAULT_REGION_SLUG, isExtent, observationToday, regionBySlug, type Region } from "./constants.ts";
import { ObsPanel } from "./obs-panel.ts";
import { createRef, ref } from "lit/directives/ref.js";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Contributor, Occurrence } from "./types.ts";
import lockupUrl from "./assets/lockup-dark.svg?url";

if (import.meta.env.PROD)
  sentryClient.init();

const viewInitiallySmall = window.innerWidth < 800;

const dateRE = /^(\d\d\d\d-\d\d-\d\d)$/;

function parseUrlParams(searchParams: URLSearchParams) {
  const dateParam = searchParams.get('d');
  const date = dateParam && dateRE.test(dateParam)
    ? dateParam
    : observationToday().toString();

  const x = parseFloat(searchParams.get('x') || '');
  const y = parseFloat(searchParams.get('y') || '');
  const z = parseFloat(searchParams.get('z') || '');

  const hasValidMapPosition = !isNaN(x) && !isNaN(y) && !isNaN(z);

  const occurrenceId = searchParams.get('o') || null;

  // An unknown or absent slug falls back to the default rather than erroring —
  // a stale link should still show the map, just not the region it asked for.
  const region = regionBySlug(searchParams.get('r'));

  return {
    date,
    occurrenceId,
    region,
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
const hadDateParam = new URLSearchParams(document.location.search).has('d');
const rawRegionParam = new URLSearchParams(document.location.search).get('r');
const hadMapPosition = ['x', 'y', 'z'].every(k => new URLSearchParams(document.location.search).has(k));

let gsiReady: Promise<void> | null = null;
function loadGSI(): Promise<void> {
  if (!gsiReady) {
    gsiReady = new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = () => resolve();
      document.head.appendChild(script);
    });
  }
  return gsiReady;
}

@customElement('salish-sea')
export default class SalishSea extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      position: fixed;
      inset: 0;
      overflow: hidden;
    }
    a {
      text-decoration: none;
    }
    .about-link {
      color: inherit;
      font-size: 1rem;
    }

    header {
      align-items: center;
      background-color: rgb(8, 13, 38);
      box-sizing: border-box;
      color: white;
      display: flex;
      justify-content: space-between;
      padding: 0.5rem;
      width: 100%;
    }

    h1 {
      align-items: center;
      display: flex;
      font-size: 1.2rem;
      gap: 0.5rem;
      margin: 0;
    }
    h1 img {
      display: block;
      height: 1.75rem;
    }

    main {
      display: flex;
      flex-direction: row;
      flex-grow: 1;
      min-height: 0;
      overflow: hidden;
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
  #isFocusingOccurrence = false
  #mapMoveDebounceTimer: ReturnType<typeof setTimeout> | null = null
  #realtimeChannel: RealtimeChannel | undefined

  @property({attribute: false})
  private focusedOccurrenceId: string | null = initialParams.occurrenceId;

  private mapRef = createRef<ObsMap>();
  private panelRef = createRef<ObsPanel>();

  @state()
  private lastOwnOccurrence: Occurrence | null = null;

  @provide({context: userContext})
  @state()
  protected user: User | undefined;

  @provide({context: contributorContext})
  @state()
  protected contributor: Contributor | undefined;

  #date: string = initialParams.date;
  @property({type: String, reflect: true})
  get date() { return this.#date }
  set date(d: string) {
    if (d === this.#date)
      return;
    this.#date = d;
    this.fetchOccurrences(d);
    if (!this.#isRestoringFromHistory) {
      if (this.#isFocusingOccurrence) {
        setQueryParams({d});
      } else {
        // A user-initiated day change clears any selected observation — it belongs to
        // another day — including its ?o= in the URL (single history entry).
        this.focusedOccurrenceId = null;
        setQueryParams({d}, {remove: ['o']});
      }
    }
  }

  #region: Region = initialParams.region;
  /**
   * The scope of every occurrence query, independent of the viewport. Panning
   * away from a region does not widen it — that is what makes this a filter and
   * not the "Go to" it grew out of.
   */
  get region() { return this.#region }
  set region(r: Region) {
    if (r.slug === this.#region.slug)
      return;
    this.#region = r;
    this.requestUpdate();
    this.fetchOccurrences(this.date);
    // The calendar invalidates its own counts when the new slug reaches it —
    // doing it from here would race the property propagation and cache the
    // region we just left. See date-calendar's willUpdate.
    if (!this.#isRestoringFromHistory) {
      if (r.slug === DEFAULT_REGION_SLUG)
        setQueryParams({}, {remove: ['r']});
      else
        setQueryParams({r: r.slug});
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
      this.region = params.region;
      this.date = params.date;
      this.focusedOccurrenceId = params.occurrenceId;
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
    const supabaseClient = supabase();
    supabaseClient.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        this.user = session?.user;
      } else if (event === 'SIGNED_OUT') {
        this.user = undefined;
      }
      this.fetchOccurrences(this.date).catch(err => console.error(err));
      if (this.user) {
        getContributor(this.user.id, supabaseClient)
          .then(contributor => this.contributor = contributor)
          .then(contributor => fetchLastOwnOccurrence(contributor, supabaseClient))
          .then(occurrence => this.lastOwnOccurrence = occurrence);
      } else {
        this.contributor = undefined;
        this.lastOwnOccurrence = null;
      }
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
    this.addEventListener('region-selected', (evt) => {
      const slug = (evt as CustomEvent<string>).detail;
      const region = regionBySlug(slug);
      // Selecting a region still moves the map, as the Go-to bubbles did before
      // they became filters. Do this unconditionally — re-picking the current
      // region after panning away is a reasonable way to ask to go back.
      this.mapRef.value!.zoomToExtent([...region.zoomExtent]);
      this.region = region;
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
      // focusOccurrence only triggers fetchOccurrences when the date changes.
      // Explicitly refresh so a newly saved sighting for the current date appears immediately.
      this.fetchOccurrences(this.date);
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
    this.#realtimeChannel = supabaseClient
      .channel('occurrences')
      .on('broadcast', {event: 'occurrences_changed'}, () => {
        this.fetchOccurrences(this.date);
      })
      .subscribe();
  }

  async connectedCallback(): Promise<void> {
    super.connectedCallback();
    window.addEventListener('popstate', this.#handlePopState);
    // Reflect the resolved date in the URL so a link shared while viewing the default
    // (today) is a permalink to that day, the way map coordinates already are. replaceState
    // adds no history entry; skip when an occurrence permalink (?o=) already pins context.
    if (!hadDateParam && !initialParams.occurrenceId)
      setQueryParams({d: this.#date}, {replace: true});
    // Normalise the region the same way. A slug we don't recognise resolved to
    // the default above, so leaving it in the URL would keep advertising a
    // region that isn't the one on screen.
    if (rawRegionParam !== null && rawRegionParam !== this.#region.slug) {
      if (this.#region.slug === DEFAULT_REGION_SLUG)
        setQueryParams({}, {replace: true, remove: ['r']});
      else
        setQueryParams({r: this.#region.slug}, {replace: true});
    }
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
    this.#realtimeChannel?.unsubscribe();
  }

  protected render(): unknown {
    const {x: initialX, y: initialY, z: initialZ} = initialParams.mapPosition;

    return html`
      <header>
        <h1><img src=${lockupUrl} alt="SalishSea.io"> <a class="about-link" href="/about.html" title="About SalishSea.io" aria-label="About SalishSea.io">&#9432;</a></h1>
        <div>
          <login-button></login-button>
        </div>
      </header>
      <main>
        <obs-map ${ref(this.mapRef)} centerX=${initialX} centerY=${initialY} zoom=${initialZ} focusedOccurrenceId=${this.focusedOccurrenceId} .maskExtent=${this.region.extent}></obs-map>
        <obs-panel ${ref(this.panelRef)} date=${this.date} regionSlug=${this.region.slug} .lastOwnOccurrence=${this.lastOwnOccurrence}>
          ${repeat(this.sightings, sighting => sighting.id, (sighting) => {
            const id = sighting.id;
            const classes = {focused: id === this.focusedOccurrenceId};
            return html`
              <obs-summary class=${classMap(classes)} id=${`summary-${id}`} ?focused=${classes.focused} .sighting=${sighting}></obs-summary>
            `;
          })}
        </obs-panel>
      </main>
    `;
  }

  doLogIn() {
    loadGSI().then(() => google.accounts.id.prompt());
  }

  async doLogOut() {
    supabase().auth.signOut();
    await this.fetchOccurrences(this.date);
  }

  public async receiveIdToken(token: string) {
    await supabase().auth.signInWithIdToken({'provider': 'google', token});
  }

  protected async firstUpdated(_changedProperties: PropertyValues): Promise<void> {
    this.olmap = this.mapRef.value!.map;
    this.drawingSource = this.mapRef.value!.drawingSource;
    // Frame the active region whenever the URL does not say otherwise —
    // including the default one, with no ?r= at all.
    //
    // The viewport and the region are the same statement about what you are
    // looking at, so they should not be able to disagree. They did: the old
    // hardcoded default centre/zoom was tuned long before regions existed and
    // is wider than the Salish Sea box, which nothing revealed until the mask
    // started drawing the difference. On a phone (default zoom 7, wider still)
    // that left roughly half the map shaded on first load, which reads as
    // "zoomed out and mostly disabled" rather than "here is the Salish Sea".
    //
    // An explicit x/y/z still wins, as does ?o=, which pins the map to an
    // occurrence.
    if (!hadMapPosition && !initialParams.occurrenceId)
      this.mapRef.value!.frameExtentWhenReady([...this.#region.zoomExtent]);
    if (initialParams.occurrenceId) {
      await this.hydrateFromOccurrenceId(initialParams.occurrenceId);
    }
  }

  /**
   * An occurrence named by `?o=` that the active region excludes.
   *
   * A permalink has to keep working whatever region the recipient lands in, so
   * this one is merged back into the region-filtered results — otherwise the
   * map centres on a point it has not drawn and the sidebar has nothing to
   * select. It stays outside the mask's clear window, which is the honest
   * picture: this sighting is real, and it is outside what you are looking at.
   *
   * Guarded on {@link focusedOccurrenceId} rather than cleared by hand, so it
   * stops applying the moment focus moves or the day changes.
   */
  #permalinkOccurrence: Occurrence | null = null;

  receiveOccurrences(occurrences: Occurrence[], forDate: string, forRegion: string) {
    // Both guards matter, and for different reasons. The date catches a day
    // change; the region catches a region change, which re-queries the SAME
    // date — so without it a slow in-flight request for the region you just
    // left can land last and repaint the map with out-of-region sightings that
    // the mask then shades over.
    if (forDate !== this.date || forRegion !== this.#region.slug)
      return;

    const pinned = this.#permalinkOccurrence;
    const merged = pinned
      && pinned.id === this.focusedOccurrenceId
      && dateFromObservedAt(pinned.observed_at) === forDate
      && !occurrences.some(o => o.id === pinned.id)
      ? [...occurrences, pinned].sort((a, b) => b.observed_at_ms - a.observed_at_ms)
      : occurrences;

    this.sightings = merged;
    this.mapRef.value!.setOccurrences(merged);
  }

  focusOccurrence(occurrence: Occurrence | null) {
    this.focusedOccurrenceId = occurrence?.id || null;
    if (occurrence) {
      // Focusing may change the date; flag it so the date setter doesn't treat this as a
      // user day-change and clear the focus we just set.
      this.#isFocusingOccurrence = true;
      try {
        this.date = Temporal.Instant.from(occurrence.observed_at).toZonedDateTimeISO('PST8PDT').toPlainDate().toString();
      } finally {
        this.#isFocusingOccurrence = false;
      }
    }

    if (!this.#isRestoringFromHistory) {
      if (this.focusedOccurrenceId) {
        setQueryParams({o: this.focusedOccurrenceId});
      } else {
        removeQueryParam('o');
      }
    }
  }

  async fetchOccurrences(date: string) {
    // Captured up front: `this.#region` can change while this is in flight, and
    // the response has to be judged against the region that asked for it.
    const region = this.#region;
    const startOfDay = Temporal.PlainDate.from(date).toZonedDateTime({timeZone: 'PST8PDT', plainTime: '00:00:00'});
    const endOfDay = startOfDay.add({days: 1});
    let query = supabase()
      .from('occurrences')
      .select()
      .gte('observed_at', startOfDay.toInstant())
      .lt('observed_at', endOfDay.toInstant());

    // `location` is a composite (lon_lat), not jsonb, but PostgREST still
    // addresses its fields with `->`. Use `->` and NOT `->>`: the text form
    // compares lexically, so numeric bounds silently match nothing — zero rows,
    // no error, no clue.
    const extent = region.extent;
    if (extent) {
      const [minx, miny, maxx, maxy] = extent;
      query = query
        .gte('location->lon', minx).lte('location->lon', maxx)
        .gte('location->lat', miny).lte('location->lat', maxy);
    }

    const {data} = await query
      .order('observed_at', {ascending: false})
      .throwOnError();

    const occurrences = data.map(record => ({
      observed_at_ms: Date.parse(record.observed_at),
      ...record,
    }));

    this.receiveOccurrences(occurrences as Occurrence[], date, region.slug);
  }

  private async hydrateFromOccurrenceId(id: string): Promise<void> {
    const {data: occurrence} = await supabase()
      .from('occurrences')
      .select()
      .eq('id', id)
      .maybeSingle<Occurrence>();
    if (!occurrence) return; // not found — silent fallback per decisions

    const date = dateFromObservedAt(occurrence.observed_at);
    // Set before fetching: the fetch's own response is the first one that has
    // to carry this occurrence, since the region may well exclude it.
    this.#permalinkOccurrence = {
      ...occurrence,
      observed_at_ms: Date.parse(occurrence.observed_at),
    };
    // Bypass the date setter to avoid writing ?d= to history
    this.#date = date;
    await this.fetchOccurrences(date);

    // Center map on occurrence location
    const {lon, lat} = occurrence.location as {lon: number; lat: number};
    const coord = fromLonLat([lon, lat]);
    this.mapRef.value!.setView(coord[0]!, coord[1]!, 12, {skipEvent: true});
    this.focusedOccurrenceId = id;
  }
}

export function dateFromObservedAt(observedAt: string): string {
  return Temporal.Instant.from(observedAt)
    .toZonedDateTimeISO('PST8PDT')
    .toPlainDate()
    .toString();
}

function setQueryParams(params: {[k: string]: string}, options: {replace?: boolean, remove?: string[]} = {}) {
    const url = new URL(window.location.href);
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
    for (const k of options.remove ?? []) {
      url.searchParams.delete(k);
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
