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
import type { LayersChangeDetail, MapMoveDetail, ObsMap } from "./obs-map.ts";
import { LAYERS_PARAM, layersParam, parseLayersParam, type ReferenceLayer } from "./reference-layers.ts";
import type { CloneSightingEvent, EditSightingEvent } from "./obs-summary.ts";
import { fetchLastOwnOccurrence } from "./occurrence.ts";
import { supabase } from "./supabase.ts";
import { fetchDayOccurrences, fetchStaticAnimalNames, findOccurrence, NotBuiltYet, overlayNative, pacificDay, readSource, watchManifest, withinExtent } from "./read-path.ts";
import { fetchMe, fetchOwnSightings, fetchPublicSighting, overlayOwn, ownOccurrence, signIn as apiSignIn, signOut as apiSignOut, writeSource, type Me } from "./write-api.ts";
import type { PatchedDatabase } from "./types.ts";
import { initSentry } from "./sentry.ts";
import { promptGoogleSignIn } from "./google-signin.ts";
import './error-toast.ts';
import type ErrorToast from './error-toast.ts';
import './feedback-form.ts';
import { reportError, type ErrorReport } from './report-error.ts';
import { v7 } from "uuid";
import type { Extent } from "ol/extent.js";
import { fromLonLat } from 'ol/proj.js';
import { DEFAULT_REGION_SLUG, isExtent, observationToday, regionBySlug, type Region } from "./constants.ts";
import { ObsPanel } from "./obs-panel.ts";
import { createRef, ref } from "lit/directives/ref.js";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Contributor, Occurrence } from "./types.ts";
import lockupUrl from "./assets/lockup-dark.svg?url";
import { renderSiteNav } from './site-nav.ts';

initSentry();

const viewInitiallySmall = window.innerWidth < 800;

const dateRE = /^(\d\d\d\d-\d\d-\d\d)$/;

/**
 * How long a tab waits after a realtime broadcast before refetching the day:
 * at least the minimum, so the ingest tick that sent it has finished its other
 * source's writes, plus a random share of the jitter, so a hundred open tabs
 * do not all ask at the same instant. The cost is that a sighting someone else
 * just reported takes this long to appear.
 */
const BROADCAST_REFETCH_MIN_MS = 3_000;
const BROADCAST_REFETCH_JITTER_MS = 5_000;

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

  const layers = parseLayersParam(searchParams.get(LAYERS_PARAM));

  return {
    date,
    layers,
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
    /* The site's nav (src/site-nav.ts), light on the header's dark blue. */
    nav.site-nav {
      display: flex;
      gap: 1rem;
      margin: 0 auto 0 1rem;
    }
    nav.site-nav a {
      color: rgba(255, 255, 255, 0.75);
      font-size: 0.95rem;
    }
    nav.site-nav a:hover,
    nav.site-nav a[aria-current="page"] {
      color: white;
    }
    nav.site-nav a[aria-current="page"] {
      font-weight: 600;
    }
    header > div {
      flex-shrink: 0;
    }
    /* A phone: the logo, three links and the login button share 390 pixels. */
    @media (max-width: 30rem) {
      h1 img {
        height: 1.375rem;
      }
      nav.site-nav {
        gap: 0.75rem;
        margin-left: 0.75rem;
      }
      nav.site-nav a {
        font-size: 0.875rem;
      }
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
      /* The toast hangs from this corner, so it clears the header without
         anyone having to hardcode the header's height. */
      position: relative;
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
        /* Not just shrink: until the panel renders it is short, and a growing
           map took the slack, then lost it a frame later. */
        flex-grow: 0;
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
  /** A refetch owed to a realtime broadcast, not yet run — see the channel handler. */
  #broadcastRefetchTimer: ReturnType<typeof setTimeout> | null = null
  #realtimeChannel: RealtimeChannel | undefined

  @property({attribute: false})
  private focusedOccurrenceId: string | null = initialParams.occurrenceId;

  private mapRef = createRef<ObsMap>();
  private panelRef = createRef<ObsPanel>();
  private errorToastRef = createRef<ErrorToast>();

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
    this.refetchOccurrences(d);
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
    this.refetchOccurrences(this.date);
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

  /** The map's reference layers switched on (GH #453). Replaces the URL entry rather than adding one: it is a view setting, not a place to go Back to. */
  @state()
  private layers: ReadonlySet<ReferenceLayer> = initialParams.layers;

  #onLayersChange = (evt: Event) => {
    this.layers = (evt as CustomEvent<LayersChangeDetail>).detail;
    const value = layersParam(this.layers);
    if (value === null)
      setQueryParams({}, {remove: [LAYERS_PARAM], replace: true});
    else
      setQueryParams({[LAYERS_PARAM]: value}, {replace: true});
  };

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
      this.layers = params.layers;
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
    if (writeSource() === 'api') {
      // The write API's session is a cookie it set (decision 065): ask who it names.
      fetchMe()
        .then(me => this.#signedInAs(me))
        .catch(err => reportError(this, "Couldn't load your account. You may not be able to report a sighting.", {cause: err}));
    } else {
      const supabaseClient = supabase();
      supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
          this.user = session?.user;
        } else if (event === 'SIGNED_OUT') {
          this.user = undefined;
        }
        // Signing in or out can change where the list comes from (decision 056:
        // the read-path files are for signed-out visitors only), so a request
        // issued before this one answers a different question.
        this.#listRevision++;
        this.refetchOccurrences(this.date);
        if (this.user) {
          getContributor(this.user.id, supabaseClient)
            .then(contributor => this.contributor = contributor)
            .then(contributor => fetchLastOwnOccurrence(contributor, supabaseClient))
            .then(occurrence => this.lastOwnOccurrence = occurrence)
            // Without this the Report button stays hidden and the form has no
            // contributor to save against, with nothing on screen saying why.
            .catch(err => reportError(this, "Couldn't load your account. You may not be able to report a sighting.", {cause: err}));
        } else {
          this.contributor = undefined;
          this.lastOwnOccurrence = null;
        }
      });
    }
    this.addEventListener('report-error', evt => {
      const {message, persist} = (evt as CustomEvent<ErrorReport>).detail;
      this.errorToastRef.value?.show(message, {persist});
    });
    this.addEventListener('log-in', this.doLogIn.bind(this));
    this.addEventListener('log-out', this.doLogOut.bind(this));
    this.addEventListener('focus-occurrence', evt => {
      const occurrence = (evt as CustomEvent<Occurrence | null>).detail;
      this.focusOccurrence(occurrence);
    });
    this.addEventListener('date-selected', (evt) => {
      const detail: unknown = evt instanceof CustomEvent ? evt.detail : undefined;
      if (typeof detail !== 'string')
        throw new Error(`date-selected carried ${typeof detail}, expected a YYYY-MM-DD date string`);
      this.date = detail;
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
      this.refetchOccurrences(this.date);
    });
    this.addEventListener('sighting-deleted', (evt) => {
      const id = (evt as CustomEvent<string>).detail;
      // Drop the row now rather than waiting on the realtime broadcast that
      // usually removes it: a missed broadcast otherwise leaves a sighting on
      // screen that the server has already deleted, and clicking it again is
      // the only way to find out. The refetch behind it reconciles the rest of
      // the list; this just makes the row's disappearance a consequence of the
      // click that asked for it.
      this.#listRevision++;
      this.sightings = this.sightings.filter(sighting => sighting.id !== id);
      this.mapRef.value?.setOccurrences(this.sightings);
      if (this.focusedOccurrenceId === id)
        this.focusOccurrence(null);
      this.refetchOccurrences(this.date);
    });
    this.addEventListener('clone-sighting', (evt) => {
      const sighting = (evt as CloneSightingEvent).detail;
      const clone = {...sighting, id: v7()};
      this.panelRef.value!.editObservation(clone)
        .catch(err => reportError(this, "Couldn't open a copy of that sighting. Please try again.", {cause: err}));
    });
    this.addEventListener('edit-observation', (evt) => {
      const sighting = (evt as EditSightingEvent).detail;
      this.panelRef.value!.editObservation(sighting)
        .catch(err => reportError(this, "Couldn't open that sighting for editing. Please try again.", {cause: err}));
    });
    // Through the write API there is no broadcast: a tab's own saves refetch on their
    // own events, and everyone else's arrive with the build the manifest announces.
    if (writeSource() === 'supabase') this.#realtimeChannel = supabase()
      .channel('occurrences')
      .on('broadcast', {event: 'occurrences_changed'}, () => {
        // One refetch per burst, a few seconds after it, at a moment of this
        // tab's own choosing. The ingest commits once per source on every
        // tick and every open tab hears each commit; refetching on each one,
        // immediately, put every tab's query onto the database at the same
        // instant, while it was still inside the tick's writes — which is
        // where a visitor's query met the 3s statement timeout (bd
        // salish-xfo, SALISHSEA-IO-3D). A broadcast is sent on commit, so a
        // refetch that starts after it arrives sees its rows: a timer already
        // pending covers every broadcast that lands before it fires.
        if (this.#broadcastRefetchTimer)
          return;
        const delay = BROADCAST_REFETCH_MIN_MS + Math.random() * BROADCAST_REFETCH_JITTER_MS;
        this.#broadcastRefetchTimer = setTimeout(() => {
          this.#broadcastRefetchTimer = null;
          this.refetchOccurrences(this.date);
        }, delay);
      })
      .subscribe();
  }

  /** Stops the read-path manifest watch; set only in static mode. */
  #stopManifestWatch: (() => void) | undefined;

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('popstate', this.#handlePopState);
    // The day comes from the read-path files, which change when a build lands,
    // not when the database does — so the realtime broadcast can't tell anyone
    // about them. The manifest can (decision 056). A signed-in tab hears both:
    // the manifest for the files, the broadcast for the native sightings it
    // overlays live (decision 061).
    if (readSource() === 'static')
      this.#stopManifestWatch = watchManifest(async () => {
        this.panelRef.value?.revalidateCalendar();
        // A failed load is retried on the next poll rather than waiting for the
        // next build to come along.
        return this.fetchOccurrences(this.date).catch(err => {
          reportError(this, "Couldn't refresh sightings. The list may be out of date.", {cause: err, persist: true});
          return false;
        });
      });
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
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('popstate', this.#handlePopState);
    if (this.#mapMoveDebounceTimer) {
      clearTimeout(this.#mapMoveDebounceTimer);
    }
    if (this.#broadcastRefetchTimer) {
      clearTimeout(this.#broadcastRefetchTimer);
      this.#broadcastRefetchTimer = null;
    }
    this.#realtimeChannel?.unsubscribe();
    this.#stopManifestWatch?.();
    this.#stopManifestWatch = undefined;
  }

  protected render(): unknown {
    const {x: initialX, y: initialY, z: initialZ} = initialParams.mapPosition;

    return html`
      <header>
        <h1><img src=${lockupUrl} alt="SalishSea.io"></h1>
        ${renderSiteNav('map')}
        <div>
          <login-button></login-button>
        </div>
      </header>
      <main>
        <obs-map ${ref(this.mapRef)} centerX=${initialX} centerY=${initialY} zoom=${initialZ} focusedOccurrenceId=${this.focusedOccurrenceId} .maskExtent=${this.region.extent} .visibleLayers=${this.layers} @layers-change=${this.#onLayersChange}></obs-map>
        <obs-panel ${ref(this.panelRef)} date=${this.date} regionSlug=${this.region.slug} .lastOwnOccurrence=${this.lastOwnOccurrence}>
          ${repeat(this.sightings, sighting => sighting.id, (sighting) => {
            const id = sighting.id;
            const classes = {focused: id === this.focusedOccurrenceId};
            return html`
              <obs-summary class=${classMap(classes)} id=${`summary-${id}`} ?focused=${classes.focused} .sighting=${sighting}></obs-summary>
            `;
          })}
        </obs-panel>
        <error-toast ${ref(this.errorToastRef)}></error-toast>
        <feedback-form></feedback-form>
      </main>
    `;
  }

  doLogIn() {
    promptGoogleSignIn((token, nonce) => {
      this.receiveIdToken(token, nonce).catch(err =>
        reportError(this, "Couldn't sign you in with Google. Please try again.", {cause: err}));
    }).catch(err => reportError(this, "Couldn't reach Google to sign in. An ad blocker may be blocking it.", {cause: err}));
  }

  /**
   * The write API's answer to who is signed in, applied (decision 065): what Supabase's
   * auth events did, for the API's session.
   */
  #signedInAs(me: Me | null) {
    this.user = me ? {id: me.user_id} : undefined;
    // Before the refetch, which overlays this contributor's own sightings.
    const contributor = me ? me.contributor as Contributor : undefined;
    this.contributor = contributor;
    // As with Supabase's events: where the list comes from changes with who is signed in.
    this.#listRevision++;
    this.refetchOccurrences(this.date);
    if (!contributor) {
      this.lastOwnOccurrence = null;
      return;
    }
    const revision = this.#listRevision;
    const now = new Date();
    fetchOwnSightings(new Date(now.getTime() - 399 * 24 * 60 * 60_000), new Date(now.getTime() + 24 * 60 * 60_000))
      .then(async own => {
        const last = own[0];
        if (!last) return null;
        return ownOccurrence(last, contributor, await fetchStaticAnimalNames([last.entity_id]).catch(() => undefined));
      })
      // A sign-out or another sign-in since makes this answer someone else's.
      .then(occurrence => { if (revision === this.#listRevision) this.lastOwnOccurrence = occurrence; })
      .catch(err => reportError(this, "Couldn't find your last sighting.", {cause: err}));
  }

  async doLogOut() {
    if (writeSource() === 'api') {
      try {
        await apiSignOut();
        this.#signedInAs(null);
      } catch (err) {
        reportError(this, "Couldn't sign you out. Please try again.", {cause: err});
      }
      return;
    }
    try {
      // Supabase returns auth failures in the result rather than throwing (see
      // receiveIdToken below) — unchecked, a failed sign-out leaves the Log out
      // button apparently doing nothing. A transport failure still throws, so
      // both shapes have to be handled to cover the one button.
      const {error} = await supabase().auth.signOut();
      if (error) throw error;
    } catch (err) {
      reportError(this, "Couldn't sign you out. Please try again.", {cause: err});
    }
    await this.refetchOccurrences(this.date);
  }

  public async receiveIdToken(token: string, nonce: string) {
    if (writeSource() === 'api') {
      try {
        this.#signedInAs(await apiSignIn(token, nonce));
      } catch (err) {
        reportError(this, "Couldn't sign you in with Google. Please try again.", {cause: err});
      }
      return;
    }
    const {error} = await supabase().auth.signInWithIdToken({'provider': 'google', token, nonce});
    // Supabase returns auth failures in the result instead of throwing, and the
    // Supabase Sentry integration only wraps PostgREST — so an unchecked error
    // here is invisible twice over: nothing reported, and a Log in button that
    // silently does nothing. That is how the nonce mismatch went unnoticed.
    if (error)
      reportError(this, "Couldn't sign you in with Google. Please try again.", {cause: error});
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
      // Lit doesn't await firstUpdated's promise, so a rejection here is an
      // unhandled one. The link named a sighting; failing to reach it is worth
      // saying, because the map otherwise just sits on the default view.
      await this.hydrateFromOccurrenceId(initialParams.occurrenceId)
        .catch(err => reportError(this, "Couldn't open the sighting this link points to.", {cause: err}));
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

  /**
   * Fire-and-forget {@link fetchOccurrences}, for the callers that have no
   * `await` to hang a failure from — property setters, event listeners, the
   * realtime subscription.
   *
   * A failed *query* already reports itself from inside `fetchOccurrences`,
   * with the staleness guard that decides whether it is still worth saying.
   * This catches what is left: a rejection from the surrounding work, which
   * would otherwise be an unhandled promise rejection and, since these callers
   * are exactly the ones that repaint the list, a sighting list silently
   * frozen on the previous day.
   */
  private refetchOccurrences(date: string): Promise<void> {
    return this.fetchOccurrences(date)
      .then(() => {}, err => reportError(this, "Couldn't refresh sightings. The list may be out of date.", {cause: err, persist: true}));
  }

  /**
   * Bumped whenever the list is edited locally ahead of the server — a confirmed
   * delete — or its source changes, on signing in or out. Date and region are
   * not enough to date a response: a request issued *before* the delete asks for
   * the same day and the same region, so both guards pass and it repaints the
   * row we just removed. It simply predates the edit, and this is what says so.
   */
  #listRevision = 0;

  /**
   * Resolves false when the load failed (and was reported), so a caller that can
   * retry — the read-path manifest watch — knows to. A response superseded by a
   * newer request still counts as done: the newer one covers it.
   */
  async fetchOccurrences(date: string): Promise<boolean> {
    // Captured up front: `this.#region` can change while this is in flight, and
    // the response has to be judged against the region that asked for it. Same
    // for the revision — see #listRevision.
    const region = this.#region;
    const revision = this.#listRevision;
    const startOfDay = Temporal.PlainDate.from(date).toZonedDateTime({timeZone: 'PST8PDT', plainTime: '00:00:00'});
    const endOfDay = startOfDay.add({days: 1});
    // Built only when Supabase is asked: through the write API, nothing here touches it.
    const supabaseQuery = () => {
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
      return query;
    };

    type Row = PatchedDatabase['public']['Views']['occurrences']['Row'];
    let data;
    try {
      // Static mode reads the day's file instead (decision 056); the region
      // filter above is then applied to the file's rows, in read-path.ts. The
      // files trail the database by up to a build, and a contributor must see a
      // sighting they just saved (decision 055), so a signed-in tab asks
      // Supabase for the native sightings alone and overlays them (decision
      // 061). Every auth change refetches, so signing in or out switches source.
      if (readSource() === 'static' && !this.user) {
        data = await fetchDayOccurrences<Row>(date, region.extent);
      } else if (readSource() === 'static') {
        // Between Pacific midnight and the first build of the new day, the day
        // has no file yet. A signed-out tab is told so (below, as an error); a
        // signed-in one still has its own sightings live, and a contributor who
        // just saved one must see it (decision 055) — so the file side reads as
        // empty for now, and a notice says the rest is on its way. Not a
        // failure of ours, so Sentry doesn't hear it (salish-xv35.22).
        let notBuiltYet = false;
        const fileSide = fetchDayOccurrences<Row>(date, region.extent).catch((err: unknown) => {
          if (!(err instanceof NotBuiltYet)) throw err;
          notBuiltYet = true;
          return [] as Row[];
        });
        if (writeSource() === 'api') {
          // Through the write API, a contributor's own sightings as saved, over the
          // file's copies of them (decision 065); everyone else's come with the build.
          const contributor = this.contributor;
          // Their own failing to load leaves the published day standing, theirs included
          // as of the last build, rather than failing the list.
          let ownFailure: unknown = null;
          const [file, own] = await Promise.all([
            fileSide,
            contributor
              ? fetchOwnSightings(new Date(startOfDay.epochMilliseconds), new Date(endOfDay.epochMilliseconds))
                .catch((err: unknown) => { ownFailure = err; return null; })
              : [],
          ]);
          if (ownFailure && date === this.date && region.slug === this.#region.slug && revision === this.#listRevision)
            reportError(this, "Couldn't load your latest sightings; showing them as last published.", {cause: ownFailure});
          const names = own?.length ? await fetchStaticAnimalNames(own.map(o => o.entity_id)).catch(() => undefined) : undefined;
          data = contributor && own
            ? overlayOwn(file, withinExtent(own.map(o => ownOccurrence(o, contributor, names)) as unknown as Row[], region.extent), contributor.id)
            : file;
        } else {
          const [file, {data: live}] = await Promise.all([
            fileSide,
            supabaseQuery().not('contributor_id', 'is', null).throwOnError(),
          ]);
          data = overlayNative(file, live);
        }
        if (notBuiltYet && date === this.date && region.slug === this.#region.slug && revision === this.#listRevision)
          reportError(this, "Today's sightings from other sources arrive with the next update; yours are shown.", {capture: false});
      } else {
        ({data} = await supabaseQuery()
          .order('observed_at', {ascending: false})
          .throwOnError());
      }
    } catch (err) {
      // Same staleness guard as receiveOccurrences, for the same reasons: a
      // slow request for the day or region you just left must not speak for
      // the one you are looking at now, and here it would claim the current,
      // complete list is incomplete.
      // Persist: an empty list is indistinguishable from a quiet day, so a
      // message that times out would leave the map lying about the water.
      if (date === this.date && region.slug === this.#region.slug && revision === this.#listRevision)
        reportError(this, "Couldn't load sightings. The list may be incomplete.", {cause: err, persist: true});
      return false;
    }

    const occurrences = data.map(record => ({
      observed_at_ms: Date.parse(record.observed_at),
      ...record,
    }));

    if (revision !== this.#listRevision)
      return true;
    this.receiveOccurrences(occurrences as Occurrence[], date, region.slug);
    return true;
  }

  /**
   * Open the app on the sighting a `?o=` link names: fetch it, move the day and
   * the map to it, and focus it. It runs before the first occurrence fetch so
   * that fetch is the first response that has to carry the sighting — the
   * active region may well exclude it, which is what {@link #permalinkOccurrence}
   * is for.
   *
   * Rejects when the lookup fails; resolves, having done nothing, when the id
   * names no sighting we have.
   */
  private async hydrateFromOccurrenceId(id: string): Promise<void> {
    let occurrence: Occurrence | null;
    if (readSource() === 'static') {
      // A signed-in tab looks for a live native sighting first (decision 061):
      // one saved since the last build is in no file yet, and one in a file may
      // have moved since.
      occurrence = null;
      if (this.user && writeSource() === 'supabase') {
        const {data, error} = await supabase()
          .from('occurrences')
          .select()
          .eq('id', id)
          .not('contributor_id', 'is', null)
          .maybeSingle<Occurrence>();
        if (error) throw error;
        occurrence = data;
      }
      // From the read-path files: the id index says which day, and the day's
      // file has the sighting (decision 056). Same contract as below: an error
      // throws, an id we don't have resolves to null. A native sighting the
      // live lookup didn't find has been deleted since the build, so a
      // signed-in tab doesn't open the file's copy of it.
      if (!occurrence) {
        const fromFile = await findOccurrence<Occurrence>(id);
        occurrence = this.user && writeSource() === 'supabase' && fromFile?.contributor_id != null ? null : fromFile;
      }
      // A native sighting no file holds yet — saved since the last build, and shared at
      // once — is in the store, which the API answers for anyone (salish-9uu.5). Only a
      // bare uuid is asked about: an upstream id carries its source (`maplify:…`) and
      // comes with the build or not at all.
      if (!occurrence && writeSource() === 'api' && !id.includes(':')) {
        occurrence = await fetchPublicSighting(id);
      }
    } else {
      const {data, error} = await supabase()
        .from('occurrences')
        .select()
        .eq('id', id)
        .maybeSingle<Occurrence>();
      // A failed lookup and a `?o=` that names a sighting we don't have both
      // arrive as a null `data`, and they are not the same thing: the second is a
      // deliberate silent fallback, the first is a link that would work if we
      // could reach the server. Throwing separates them — firstUpdated's catch
      // says so. (maybeSingle reports zero rows as data: null with no error, so
      // this does not swallow the fallback.)
      if (error) throw error;
      occurrence = data;
    }
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
  return pacificDay(observedAt);
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
}
