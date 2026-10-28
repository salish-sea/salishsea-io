import { css, html, LitElement, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { individualPath, matrilinePath, type OccurrenceLink } from './catalog.ts';
import { matrilineTitle } from './matriline-profile.ts';
import { individualStyles, individualTitle, renderIndividualProfile, renderIndividualSightings, type IndividualProfileData } from './individual-profile.ts';
import { renderMatrilineProfile, renderMatrilineSightings, type MatrilineProfileData } from './matriline-profile.ts';
import { latestLink, profileStyles } from './profile-shared.ts';
import { fetchManifest, findOccurrence, pacificDay, READ_PATH_BASE } from './read-path.ts';
import type { Occurrence } from './types.ts';
import './obs-summary.ts';
import {
  decodeSubjectData, interceptableAnchor, occurrenceFromHref, sameSubject, subjectDataPath, subjectFromHref, subjectLinksPath,
  type OccurrenceTarget, type Subject,
} from './subject.ts';

export type { OccurrenceTarget } from './subject.ts';

/** A subject's page data and sighting links, once both have arrived. */
type Loaded =
  | {kind: 'individuals', subject: Subject, data: IndividualProfileData, links: OccurrenceLink[], currentYear?: number}
  | {kind: 'matrilines', subject: Subject, data: MatrilineProfileData, links: OccurrenceLink[], currentYear?: number};

/**
 * The map page's sidebar showing one subject, an animal or a matriline, in place of the
 * day's list (salish-7ds1.1, epic salish-fwyt). It reads the data the read-path build
 * renders the subject's own page from, and draws it with the page's own templates, so the
 * two can't drift apart; the page's small map is left out, since the big one is beside it.
 *
 * Its Sightings section starts with "Last reported" and that sighting's full card, as on
 * the map, then the table (Peter, 2026-10-27). A link to another animal or matriline opens
 * it here; "Last reported", or the card's dot, moves the map to that day and selects the
 * sighting, which closes the subject. Any other link, and any
 * link opened in a new tab or window, behaves as a link does.
 *
 * Events, all bubbling out of the shadow root: `close-subject` from its Back button,
 * `open-subject` with a {@link Subject}, `go-to-occurrence` with an {@link OccurrenceTarget}.
 */
@customElement('subject-view')
export class SubjectView extends LitElement {
  static styles = [profileStyles, individualStyles, css`
    :host {
      box-sizing: border-box;
      display: block;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0 0.75rem 5.5rem;
    }
    nav.back {
      background: white;
      border-bottom: 1px solid var(--color-border);
      margin: 0 -0.75rem 0.75rem;
      padding: 0.375rem 0.5rem;
      position: sticky;
      top: 0;
      z-index: 1;
    }
    nav.back button {
      background: transparent;
      border: 0;
      border-radius: 4px;
      color: var(--color-primary);
      cursor: pointer;
      font: inherit;
      font-weight: 400;
      min-height: 36px;
      padding: 0.25rem 0.5rem;
    }
    nav.back button:hover {
      background: var(--color-surface-subtle);
    }
    nav.back button:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 1px;
    }
    /* The page's masthead, sized for a sidebar 25rem wide. */
    header.masthead {
      margin-bottom: 0.75rem;
    }
    h1 {
      font-size: var(--fs-h5);
    }
    .vitals {
      font-size: var(--fs-body1);
    }
    section {
      margin-top: 1.25rem;
    }
    .status {
      color: var(--color-text-muted);
      padding: 1rem 0;
    }
    .latest-card {
      margin: 0.5rem 0 1rem;
    }
    a.full-page {
      border: 1px solid var(--color-primary);
      border-radius: 4px;
      display: inline-block;
      font-weight: 400;
      margin-top: 1.5rem;
      padding: 0.375rem 0.75rem;
      text-decoration: none;
    }
    a.full-page:hover {
      background: var(--color-primary-tint);
    }
  `];

  /** The subject to show; null shows nothing. */
  @property({attribute: false})
  subject: Subject | null = null;

  /** What the Back button returns to, such as the day: "Sat, Oct 24". */
  @property({attribute: 'back-label'})
  backLabel = 'Back';

  @state() private loaded: Loaded | null = null;
  @state() private failed = false;
  /** The newest sighting, for its card; undefined while it loads, null if it can't be found. */
  @state() private latest: Occurrence | null | undefined = undefined;

  constructor() {
    super();
    this.addEventListener('click', this.onClick);
    this.addEventListener('focus-occurrence', this.onCardFocus);
    this.addEventListener('sighting-deleted', this.onCardDeleted);
  }

  /** What the subject is called, as its page's title has it; null until it has loaded. */
  get subjectTitle(): string | null {
    const loaded = this.loaded;
    if (!loaded || !sameSubject(loaded.subject, this.subject)) return null;
    return loaded.kind === 'individuals' ? individualTitle(loaded.data) : matrilineTitle(loaded.data);
  }

  // Deleted from its own card here: the card goes. The page's handler drops it from the
  // day's list too, as the event carries on up.
  private onCardDeleted = (event: Event) => {
    if ((event as CustomEvent<string>).detail === this.latest?.id) this.latest = null;
  };

  // The card's dot asks to focus its sighting. Here that means going to its day on the
  // map, as "Last reported" does, not focusing it under a sidebar that stays open.
  private onCardFocus = (event: Event) => {
    const occurrence = (event as CustomEvent<Occurrence | null>).detail;
    if (!occurrence) return;
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent<OccurrenceTarget>('go-to-occurrence', {bubbles: true, composed: true,
      detail: {date: pacificDay(occurrence.observed_at), occurrenceId: occurrence.id}}));
  };

  /** The subject last shown, so that hiding the view and showing it again keeps what it had loaded. */
  #shown: Subject | null = null;
  /**
   * The subject whose data is being loaded or was last loaded. A load's result is kept if
   * it is still this one, even while the view is hidden: hidden before its data arrived,
   * the same subject shown again must not wait on a load that was thrown away.
   */
  #requested: Subject | null = null;

  protected willUpdate(changed: PropertyValues<this>): void {
    // Hidden (no subject), the view keeps what it loaded: Back to the same subject, after
    // "Last reported" for one, shows it at once, where it was scrolled to. It is not
    // refetched, so an edit made meanwhile, or a new build, shows only once another
    // subject has been opened or the page reloaded.
    if (changed.has('subject') && this.subject && !sameSubject(this.subject, this.#requested)) {
      this.#requested = this.subject;
      this.loaded = null;
      this.failed = false;
      this.latest = undefined;
      void this.load(this.subject);
    }
  }

  /** Put keyboard focus on the Back button, as the view opens. */
  focusBack(): void {
    this.renderRoot.querySelector<HTMLButtonElement>('nav.back button')?.focus();
  }

  protected updated(changed: PropertyValues<this>): void {
    // A different subject starts at its top, not where the last one was scrolled to.
    if (changed.has('subject') && this.subject && !sameSubject(this.subject, this.#shown)) {
      this.scrollTop = 0;
      this.#shown = this.subject;
    }
  }

  private async load(subject: Subject): Promise<void> {
    try {
      const [dataResponse, linksResponse, manifest] = await Promise.all([
        fetch(`${READ_PATH_BASE}${subjectDataPath(subject)}`),
        fetch(`${READ_PATH_BASE}${subjectLinksPath(subject)}`),
        // The presence table ends on the build's year, as the page's does, not the browser's.
        fetchManifest().catch(() => null),
      ]);
      if (!dataResponse.ok) throw new Error(`${subjectDataPath(subject)}: ${dataResponse.status}`);
      const data = decodeSubjectData<IndividualProfileData & MatrilineProfileData>(await dataResponse.text());
      // A subject without its links still shows, as one with no sightings yet.
      const links: OccurrenceLink[] = linksResponse.ok ? await linksResponse.json() : [];
      // Only if this is still the subject asked for: a quick second click can overtake the first.
      if (!sameSubject(subject, this.#requested)) return;
      const currentYear = manifest ? Number(manifest.covered_through.slice(0, 4)) : undefined;
      this.loaded = {kind: subject.kind, subject, data, links, currentYear} as Loaded;
      void this.loadLatest(subject, links);
    } catch {
      if (sameSubject(subject, this.#requested)) this.failed = true;
    }
  }

  private async loadLatest(subject: Subject, links: OccurrenceLink[]): Promise<void> {
    const last = latestLink(links);
    let latest: Occurrence | null = null;
    try {
      const found = last ? await findOccurrence<Omit<Occurrence, 'observed_at_ms'>>(last.latest.occurrence_id) : null;
      latest = found ? {...found, observed_at_ms: Date.parse(found.observed_at)} as Occurrence : null;
    } catch {
      // Without its card the section still says when it was last reported, with the link.
    }
    if (sameSubject(subject, this.#requested)) this.latest = latest;
  }

  private pagePath(): string | null {
    const loaded = this.loaded;
    if (!loaded) return null;
    return loaded.kind === 'individuals' ? individualPath(loaded.data.profile) : matrilinePath(loaded.data.group);
  }

  protected render() {
    if (!this.subject) return nothing;
    return html`
      <nav class="back"><button type="button" aria-label=${`Back to ${this.backLabel}`} @click=${this.onBack}>‹ ${this.backLabel}</button></nav>
      ${this.renderBody()}
    `;
  }

  private renderBody() {
    const loaded = this.loaded;
    if (this.failed)
      return html`<p class="status">Couldn't load this ${this.subject!.kind === 'individuals' ? 'animal' : 'matriline'}. <a class="full-page-link" href=${`/${this.subject!.kind}/${this.subject!.id}`}>Open its page</a> instead.</p>`;
    if (!loaded) return html`<p class="status">Loading…</p>`;
    const latestCard = this.latest === undefined ? html`<p class="status">Loading the sighting…</p>`
      : this.latest ? html`<obs-summary .sighting=${this.latest}></obs-summary>` : nothing;
    const options = {map: false, latestCard, currentYear: loaded.currentYear};
    const body = loaded.kind === 'individuals'
      ? renderIndividualProfile(loaded.data, renderIndividualSightings(loaded.data.profile.primary_designation, loaded.links, options))
      : renderMatrilineProfile(loaded.data, renderMatrilineSightings(loaded.data.group.designation, loaded.links, options));
    return html`
      ${body}
      <a class="full-page" href=${this.pagePath()!}>Open the full page →</a>
    `;
  }

  private onBack = () => {
    this.dispatchEvent(new Event('close-subject', {bubbles: true, composed: true}));
  };

  // Links inside the templates are plain anchors; the ones the sidebar can follow
  // itself are taken over here. A click with a modifier key, or with any button but the
  // first, still opens the page, in whatever tab or window the visitor asked for.
  private onClick = (event: MouseEvent) => {
    const anchor = interceptableAnchor(event);
    // The links to the subject's own page are meant to leave the map.
    if (!anchor || anchor.classList.contains('full-page') || anchor.classList.contains('full-page-link')) return;
    const href = anchor.getAttribute('href') ?? '';
    const subject = subjectFromHref(href);
    if (subject) {
      event.preventDefault();
      // From the link, so the page knows where focus goes when the subject closes.
      anchor.dispatchEvent(new CustomEvent<Subject>('open-subject', {bubbles: true, composed: true, detail: subject}));
      return;
    }
    const occurrence = occurrenceFromHref(href);
    if (occurrence) {
      event.preventDefault();
      this.dispatchEvent(new CustomEvent<OccurrenceTarget>('go-to-occurrence', {bubbles: true, composed: true, detail: occurrence}));
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'subject-view': SubjectView;
  }
}
