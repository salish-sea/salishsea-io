import { css, html, LitElement, nothing, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { individualPath, matrilinePath, type OccurrenceLink } from './catalog.ts';
import { individualStyles, renderIndividualProfile, renderIndividualSightings, type IndividualProfileData } from './individual-profile.ts';
import { renderMatrilineProfile, renderMatrilineSightings, type MatrilineProfileData } from './matriline-profile.ts';
import { profileStyles } from './profile-shared.ts';
import { READ_PATH_BASE } from './read-path.ts';
import { decodeSubjectData, sameSubject, subjectDataPath, subjectFromHref, subjectLinksPath, type Subject } from './subject.ts';

/** A subject's page data and sighting links, once both have arrived. */
type Loaded =
  | {subject: Subject & {kind: 'individuals'}, data: IndividualProfileData, links: OccurrenceLink[]}
  | {subject: Subject & {kind: 'matrilines'}, data: MatrilineProfileData, links: OccurrenceLink[]};

/** Where a "Last reported" link points: a day on the map, and the sighting to select. */
export interface OccurrenceTarget {
  date: string;
  occurrenceId: string;
}

/** A link on the map page to a day and a sighting, as `mapUrl` writes them: `/?d=2026-10-24&o=maplify%3A1`. */
export function occurrenceFromHref(href: string, base = window.location.origin): OccurrenceTarget | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  if (url.origin !== new URL(base).origin || url.pathname !== '/') return null;
  const date = url.searchParams.get('d');
  const occurrenceId = url.searchParams.get('o');
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) && occurrenceId ? {date, occurrenceId} : null;
}

/**
 * The map page's sidebar showing one subject, an animal or a matriline, in place of the
 * day's list (salish-7ds1.1, epic salish-fwyt). It reads the data the read-path build
 * renders the subject's own page from, and draws it with the page's own templates, so the
 * two can't drift apart; the page's small map is left out, since the big one is beside it.
 *
 * A link to another animal or matriline opens it here; "Last reported" moves the map to
 * that day and selects the sighting, which closes the subject. Any other link, and any
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
      font-family: Mukta, Helvetica, Arial, sans-serif;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 0 0.75rem 5.5rem;
    }
    nav.back {
      background: white;
      border-bottom: 1px solid #e2e8f0;
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
      color: #1976d2;
      cursor: pointer;
      font: inherit;
      font-weight: 600;
      min-height: 36px;
      padding: 0.25rem 0.5rem;
    }
    nav.back button:hover {
      background: #f1f5f9;
    }
    nav.back button:focus-visible {
      outline: 2px solid #1976d2;
      outline-offset: 1px;
    }
    /* The page's masthead, sized for a sidebar 25rem wide. */
    header.masthead {
      margin-bottom: 0.75rem;
    }
    h1 {
      font-size: 1.75rem;
    }
    .vitals {
      font-size: 1rem;
    }
    section {
      margin-top: 1.25rem;
    }
    .status {
      color: #64748b;
      padding: 1rem 0;
    }
    a.full-page {
      border: 1px solid #1976d2;
      border-radius: 4px;
      display: inline-block;
      font-weight: 600;
      margin-top: 1.5rem;
      padding: 0.375rem 0.75rem;
      text-decoration: none;
    }
    a.full-page:hover {
      background: #e3f2fd;
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

  constructor() {
    super();
    this.addEventListener('click', this.onClick);
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('subject') && !sameSubject(this.subject, this.loaded?.subject ?? null)) {
      this.loaded = null;
      this.failed = false;
      if (this.subject) void this.load(this.subject);
    }
  }

  protected updated(changed: PropertyValues<this>): void {
    // A new subject starts at its top, not where the last one was scrolled to.
    if (changed.has('subject')) this.scrollTop = 0;
  }

  private async load(subject: Subject): Promise<void> {
    try {
      const [dataResponse, linksResponse] = await Promise.all([
        fetch(`${READ_PATH_BASE}${subjectDataPath(subject)}`),
        fetch(`${READ_PATH_BASE}${subjectLinksPath(subject)}`),
      ]);
      if (!dataResponse.ok) throw new Error(`${subjectDataPath(subject)}: ${dataResponse.status}`);
      const data = decodeSubjectData<IndividualProfileData & MatrilineProfileData>(await dataResponse.text());
      // A subject without its links still shows, as one with no sightings yet.
      const links: OccurrenceLink[] = linksResponse.ok ? await linksResponse.json() : [];
      // Only if this is still the subject asked for: a quick second click can overtake the first.
      if (sameSubject(subject, this.subject)) this.loaded = {subject, data, links} as Loaded;
    } catch {
      if (sameSubject(subject, this.subject)) this.failed = true;
    }
  }

  private pagePath(): string | null {
    const loaded = this.loaded;
    if (!loaded) return null;
    return loaded.subject.kind === 'individuals' ? individualPath(loaded.data.profile) : matrilinePath(loaded.data.group);
  }

  protected render() {
    if (!this.subject) return nothing;
    return html`
      <nav class="back"><button type="button" @click=${this.onBack}>‹ ${this.backLabel}</button></nav>
      ${this.renderBody()}
    `;
  }

  private renderBody() {
    const loaded = this.loaded;
    if (this.failed)
      return html`<p class="status">Couldn't load this ${this.subject!.kind === 'individuals' ? 'animal' : 'matriline'}. <a href=${`/${this.subject!.kind}/${this.subject!.id}`}>Open its page</a> instead.</p>`;
    if (!loaded) return html`<p class="status">Loading…</p>`;
    const body = loaded.subject.kind === 'individuals'
      ? renderIndividualProfile(loaded.data, renderIndividualSightings(loaded.data.profile.primary_designation, loaded.links, {map: false}))
      : renderMatrilineProfile(loaded.data, renderMatrilineSightings(loaded.data.group.designation, loaded.links, {map: false}));
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
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const anchor = event.composedPath().find((n): n is HTMLAnchorElement => n instanceof HTMLAnchorElement);
    if (!anchor || anchor.target === '_blank' || anchor.classList.contains('full-page')) return;
    const href = anchor.getAttribute('href') ?? '';
    const subject = subjectFromHref(href);
    if (subject) {
      event.preventDefault();
      this.dispatchEvent(new CustomEvent<Subject>('open-subject', {bubbles: true, composed: true, detail: subject}));
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
