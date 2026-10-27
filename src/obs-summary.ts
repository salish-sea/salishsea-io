import { reportError } from './report-error.ts';
import { css, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { html } from "lit/static-html.js";
import {unsafeHTML} from 'lit/directives/unsafe-html.js';
import { contributorContext, userContext, type User } from "./identity.ts";
import { consume } from "@lit/context";
import { when } from "lit/directives/when.js";
import { repeat } from "lit/directives/repeat.js";
import { GROUPS, displayNameFor, taxonGroup } from "./symbology.ts";
import { marked, Renderer } from 'marked';
import createDOMPurify from 'dompurify';
import { guard } from "lit/directives/guard.js";
import { Temporal } from "temporal-polyfill";
import { deleteSighting } from './write-api.ts';
import type { Contributor, Occurrence } from "./types.ts";
import { canEdit, isUnconfirmed } from "./occurrence.ts";
import { injectPartnerLinks } from './partner-links.ts';
import { catalogCodes, ecotypeCodes, injectIndividualLinks, loadCatalogCodes, matrilineCodes, namedAnimals } from './individual-links.ts';

const domPurify = createDOMPurify(window as any);

const markedRenderer = new Renderer();
// Site-internal links (injected individual-profile links) stay in this tab;
// everything else — external partner/source links — opens in a new one.
// `//host/...` is protocol-relative, i.e. external: bodies are third-party
// text, and such a link must not masquerade as internal.
markedRenderer.link = ({ href, text }: { href: string; text: string }) =>
  href.startsWith('/') && !href.startsWith('//')
    ? `<a href="${href}">${text}</a>`
    : `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

@customElement('obs-summary')
export class ObsSummary extends LitElement {
  @property({attribute: false})
  private sighting!: Occurrence

  @property({type: Boolean, reflect: true})
  private focused = false

  @property({type: Boolean, reflect: true, attribute: 'own-observation'})
  protected ownObservation = false

  @state() private copied = false;
  @state() private menuOpen = false;

  // Flips once the catalog code lookup arrives so guarded bodies re-render
  // with individual-profile links; until then codes show as plain text.
  @state() private catalogLoaded = catalogCodes() !== null;

  static styles = css`
    /* A card: each sighting one bordered object, the panel's gap between them
       (salish-fwyt.1, after the sidebar mockup). */
    :host {
      background-color: white;
      border: 1px solid #d9dde3;
      border-radius: 6px;
      display: block;
      line-height: 1.5;
      padding: 0.625rem 0.75rem;
    }
    :host([own-observation]) {
      background-color: rgba(128, 128, 128, 0.1);
    }
    :host(.focused) {
      background-color: #e3f2fd;
      border-color: #1976d2;
    }
    header {
      align-items: baseline;
      display: flex;
      gap: 0.5rem;
      justify-content: space-between;
      position: relative;
    }
    .species-info {
      align-items: baseline;
      display: flex;
      flex-grow: 1;
      gap: 0.5rem;
    }
    time {
      color: #64748b;
      font-size: 0.75rem;
      white-space: nowrap;
    }
    a {
      color: #1976d2;
      text-decoration: none;
      word-break: break-word;
    }
    a:hover {
      color: #1565c0;
    }
    /* Who saw it and through whom, quietly at the foot of the card. */
    cite {
      color: #64748b;
      display: block;
      font-size: 0.8125rem;
      font-style: normal;
      margin-top: 0.5rem;
    }
    /* The animals and matrilines the sighting names, as chips. */
    ul.animals {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      list-style: none;
      margin: 0.375rem 0 0;
      padding: 0;
    }
    ul.animals li {
      border: 1px solid #c8d6e0;
      border-radius: 999px;
      color: #64748b;
      font-size: 0.8125rem;
      line-height: 1.6;
      padding: 0 0.55rem;
    }
    ul.animals li:has(a) {
      padding: 0;
    }
    ul.animals a {
      border-radius: 999px;
      display: block;
      padding: 0 0.55rem;
    }
    ul.animals a:hover {
      background: #eef6f9;
    }
    cite a {
      color: inherit;
      text-decoration: underline;
    }
    cite a:hover {
      color: #1976d2;
    }
    cite .observer {
      color: #475569;
    }
    .provider {
      color: #64748b;
      display: block;
      font-size: 0.75rem;
      font-style: normal;
      margin-top: 0.125rem;
    }
    p {
      margin: 0.5rem 0 0;
    }
    p:last-child {
      margin-bottom: 0;
    }
    .count {
      color: #64748b;
      font-size: 0.8125rem;
    }
    .focus-occurrence {
      /* The taxon colour is set inline, per occurrence. The white ring is what
         keeps a near-black orca dot from reading as a hole in the panel. */
      border: 2px solid #ffffff;
      border-radius: 50%;
      box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.25);
      display: inline-block;
      flex-shrink: 0;
      height: 0.75rem;
      align-self: center;
      text-decoration: none;
      width: 0.75rem;
    }
    /* An unconfirmed sighting's dot is outlined, as on the map (decision 080). */
    .focus-occurrence.unconfirmed {
      border-color: var(--taxon-color);
    }
    .confirmation {
      color: #64748b;
      font-size: 0.75rem;
      font-style: italic;
    }
    .focus-occurrence:hover {
      box-shadow: 0 0 0 2px rgba(15, 23, 42, 0.55);
    }
    ul.photos {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      list-style: none;
      margin: 1rem 0 0 0;
      padding: 0;
    }
    /* The card's actions, behind a button right of the time (salish-fwyt.1). The
       button keeps its 44px touch target while sitting on the heading's baseline. */
    .more {
      align-self: center;
      background: transparent;
      border: 0;
      border-radius: 4px;
      color: #64748b;
      cursor: pointer;
      display: flex;
      flex: none;
      margin: -12px -12px -12px -6px;
      min-height: 44px;
      min-width: 44px;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    .more:hover, .more[aria-expanded="true"] {
      color: #1e293b;
    }
    .more:hover .dots, .more[aria-expanded="true"] .dots {
      background: rgba(0, 0, 0, 0.06);
    }
    .more:focus-visible {
      outline: 2px solid #1976d2;
      outline-offset: -6px;
    }
    .dots {
      border-radius: 4px;
      display: block;
      padding: 2px;
    }
    /* The account menu's surface (src/account-menu.ts), smaller. */
    .menu {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
      box-sizing: border-box;
      min-width: 10rem;
      padding: 6px 0;
      position: absolute;
      right: -6px;
      top: calc(100% + 6px);
      z-index: 1000;
    }
    .menu button {
      background: transparent;
      border: 0;
      box-sizing: border-box;
      color: #213547;
      cursor: pointer;
      display: block;
      font: inherit;
      font-size: 0.875rem;
      min-height: 40px;
      padding: 8px 16px;
      text-align: left;
      width: 100%;
    }
    .menu button:hover {
      background: rgba(0, 0, 0, 0.05);
    }
    .menu button:focus-visible {
      outline: 2px solid #1976d2;
      outline-offset: -2px;
    }
    .menu button.danger {
      color: #b91c1c;
    }
  `;

  @consume({context: userContext, subscribe: true})
  private user: User | undefined;

  @consume({context: contributorContext, subscribe: true})
  private contributor: Contributor | undefined;

  connectedCallback(): void {
    super.connectedCallback();
    if (!this.catalogLoaded)
      loadCatalogCodes().then(() => { this.catalogLoaded = true; }, () => { /* codes stay plain text */ });
  }

  protected willUpdate(changedProperties: PropertyValues): void {
    if (changedProperties.has('contributor') || changedProperties.has('sighting')) {
      this.ownObservation = !!(this.contributor && this.sighting?.contributor_id === this.contributor.id);
    }
  }

  public render() {
    // `sighting` is a required property, but a reactive update (e.g. a context
    // change) can fire before it is assigned; render nothing rather than throw.
    if (!this.sighting) return nothing;
    const {
      body, confirmation, count, disagreements, identifiers, observed_at, photos, provider_slug, taxon, url, vitality
    } = this.sighting;
    // The same dot, in the same colour, as the marker on the map — which is the
    // whole point of decision 029's palette. It used to be a letter, and the
    // letter was ambiguous: `H` was both humpback and harbour porpoise.
    const group = GROUPS[taxonGroup(taxon.scientific_name)];
    const name = displayNameFor(taxon);
    const editable = this.contributor && canEdit(this.sighting, this.contributor) || false;
    const unconfirmed = isUnconfirmed(this.sighting);

    return html`
      <header>
        <div class="species-info">
          <a class="focus-occurrence ${unconfirmed ? 'unconfirmed' : ''}" @click="${this.focusSighting}" href="#"
             aria-label="Focus this ${group.label.toLowerCase()} on the map"
             title="Focus on map" style="background-color: ${unconfirmed ? '#ffffff' : group.color}; --taxon-color: ${group.color}"></a>
          <b>${name}</b>
          ${when(count && count > 0, () => html`<span class="count">×${count}</span>`)}
          ${when(unconfirmed, () => html`<span class="confirmation" title=${confirmationNote(this.sighting)}>${confirmation === 'disputed' ? 'Disputed' : 'Unconfirmed'}</span>`)}
          ${when(vitality === 'dead', () => html`<span class="confirmation" title="Annotated dead on iNaturalist: a stranded or floating animal, not one travelling">Dead</span>`)}
          ${when(!unconfirmed && disagreements, () => html`<span class="confirmation" title="Confirmed: at least two thirds of the others who identified it agree">${disagreements === 1 ? '1 identifier disagrees' : `${disagreements} identifiers disagree`}</span>`)}
        </div>
        <time>${guard([observed_at], () => html`${
          Temporal.Instant.from(observed_at).toZonedDateTimeISO('America/Los_Angeles').toPlainTime().toString({smallestUnit: 'minute', roundingMode: 'halfCeil'})
        }`)}</time>
        <button class="more" type="button" aria-haspopup="menu" aria-expanded=${this.menuOpen ? 'true' : 'false'}
          aria-label="Actions for this sighting" title="Actions" @click=${this.toggleMenu}>
          <svg class="dots" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true">
            <circle cx="4" cy="10" r="1.6"></circle><circle cx="10" cy="10" r="1.6"></circle><circle cx="16" cy="10" r="1.6"></circle>
          </svg>
        </button>
        ${this.menuOpen ? this.renderMenu(editable) : nothing}
      </header>
      ${guard([identifiers, this.catalogLoaded], () => {
        const animals = namedAnimals(identifiers, catalogCodes() ?? new Map(), matrilineCodes() ?? new Map());
        return animals.length ? html`<ul class="animals">${animals.map(({label, href}) =>
          html`<li>${href ? html`<a href=${href}>${label}</a>` : label}</li>`)}</ul>` : nothing;
      })}
      ${guard([body, this.catalogLoaded], () => html`${
        unsafeHTML(domPurify.sanitize(
          marked.parse(
            injectIndividualLinks(
              injectPartnerLinks(stripResolvedProvenance((body || '').replace(/(<br\s*\/?\s*>\s*)+/gi, '\n\n'), provider_slug)),
              catalogCodes() ?? new Map(),
              matrilineCodes() ?? new Map(),
              ecotypeCodes() ?? new Map()
            ),
            { async: false, renderer: markedRenderer }
          ),
          { ADD_ATTR: ['target', 'rel'] }
        ))
      }`)}
      ${photos?.length ?
        html`<ul class="photos">${
          repeat(photos, photo => photo.src, ({attribution, src, thumb}) => html`
            <li><a target="_blank" href=${url || src}><img alt=${attribution || 'photo of subject'} height="75" loading="lazy" src=${thumb || src}></a></li>
          `)
        }</ul>`
      : undefined}
      ${this.renderProvenance()}
    `
  }

  /** The card's actions: copying its link for anyone, cloning for the signed in, and editing and deleting for whoever may. */
  private renderMenu(editable: boolean) {
    return html`
      <div class="menu" role="menu" aria-label="Actions for this sighting" @keydown=${this.onMenuKeydown}>
        <button type="button" role="menuitem" @click=${this.onCopyLink}>${this.copied ? 'Copied!' : 'Copy link'}</button>
        ${when(this.user, () => html`<button type="button" role="menuitem" @click=${this.onClone}>Clone</button>`)}
        ${when(editable, () => html`
          <button type="button" role="menuitem" @click=${this.onEdit}>Edit</button>
          <button type="button" role="menuitem" class="danger" @click=${this.onDelete}>Delete</button>
        `)}
      </div>
    `;
  }

  // The page is listened to only while this card's menu is open: a day can hold
  // a hundred cards, and each would otherwise hear every click.
  // The click is left to reach the page, so another card's open menu hears it and
  // closes; this card's own listener ignores clicks inside the card.
  private toggleMenu = () => {
    this.setMenuOpen(!this.menuOpen);
  };

  private setMenuOpen(open: boolean, returnFocus = false) {
    if (open === this.menuOpen) return;
    this.menuOpen = open;
    if (open) {
      document.addEventListener('click', this.onDocumentClick);
      document.addEventListener('keydown', this.onDocumentKeydown);
      this.updateComplete.then(() => this.menuItems()[0]?.focus());
    } else {
      document.removeEventListener('click', this.onDocumentClick);
      document.removeEventListener('keydown', this.onDocumentKeydown);
      if (returnFocus) this.shadowRoot?.querySelector<HTMLButtonElement>('.more')?.focus();
    }
  }

  private menuItems(): HTMLButtonElement[] {
    return [...this.shadowRoot?.querySelectorAll<HTMLButtonElement>('.menu [role="menuitem"]') ?? []];
  }

  private onDocumentClick = (event: MouseEvent) => {
    if (!event.composedPath().includes(this)) this.setMenuOpen(false);
  };

  private onDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') this.setMenuOpen(false, true);
  };

  // Up and down move between the items, wrapping; Home and End go to the ends; Tab leaves.
  private onMenuKeydown = (event: KeyboardEvent) => {
    const items = this.menuItems();
    const at = items.indexOf(this.shadowRoot?.activeElement as HTMLButtonElement);
    const to = {ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1}[event.key];
    if (to !== undefined) {
      event.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    } else if (event.key === 'Tab') {
      this.setMenuOpen(false);
    }
  };

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.setMenuOpen(false);
  }

  // Renders the provenance line(s) from the v1.3 provenance graph:
  //   "Observed by {observer} · via {collection}"  +  a muted "Added via {provider}"
  // Observer is suppressed where the source carries no real name (e.g. Maplify,
  // whose usernm is always an opaque app/API code). The collection links to the
  // record's source_url, falling back to the backing organization's homepage.
  private renderProvenance() {
    const {
      observer, collection, source_url, organization_url, provider, provider_slug, url, attribution,
    } = this.sighting;
    // Directly-entered sightings: drop the awkward "via SalishSea.io Direct" and
    // the redundant provider line — the contributor is the whole story. The name
    // links to the record's source_url where one was supplied.
    if (provider_slug === 'direct') {
      const who = observer || 'a contributor';
      const observerHref = safeExternalHref(source_url);
      return html`<cite>Observed by ${observerHref
        ? html`<span class="observer"><a target="_blank" rel="noopener noreferrer" href=${observerHref}>${who}</a></span>`
        : html`<span class="observer">${who}</span>`}</cite>`;
    }
    const channel = collection || provider;
    if (!channel) {
      // Legacy fallback — provider is NOT NULL in the view, so this is unreachable
      // for current data, but keeps old/odd rows from rendering an empty line.
      const legacyHref = safeExternalHref(url);
      return html`<cite>via ${legacyHref ? html`<a target="_blank" rel="noopener noreferrer" href=${legacyHref}>${attribution}</a>` : attribution}</cite>`;
    }
    const channelHref = safeExternalHref(source_url) ?? safeExternalHref(organization_url);
    const channelLabel = channelHref
      ? html`<a target="_blank" rel="noopener noreferrer" href=${channelHref}>${channel}</a>`
      : channel;
    // The provider line only adds information when it differs from the channel —
    // i.e. Maplify behind an Orca Network FB sighting, not "via iNaturalist /
    // iNaturalist". Also suppressed for the Whale Alert family: those collections
    // ARE the conserve.io/Maplify product, so "via Whale Alert (Alaska)" and
    // "Added via Maplify / conserve.io" say the same thing.
    const isWhaleAlert = !!collection?.startsWith('Whale Alert');
    const showProvider = !!provider && !!collection && provider !== collection && !isWhaleAlert;
    return html`
      <cite>${observer ? html`Observed by <span class="observer">${observer}</span> · ` : nothing}via ${channelLabel}</cite>
      ${showProvider ? html`<small class="provider">Added via ${provider}</small>` : nothing}
    `;
  }

  private async onCopyLink(e: Event): Promise<void> {
    e.preventDefault();
    const url = buildShareUrl(this.sighting.id);
    await navigator.clipboard.writeText(url);
    this.copied = true;
    setTimeout(() => { this.copied = false; this.setMenuOpen(false); }, 1200);
  }

  private focusSighting(interaction: Event) {
    interaction.preventDefault();
    const focusSighting = new CustomEvent('focus-occurrence', {bubbles: true, composed: true, detail: this.sighting});
    this.dispatchEvent(focusSighting)
  }

  protected updated(changedProperties: PropertyValues): void {
    if (changedProperties.has('focused') && this.focused)
      this.scrollIntoView({block: 'center'});
  }

  private async onClone(e: Event) {
    e.preventDefault();
    this.setMenuOpen(false);
    this.dispatchEvent(new CustomEvent('clone-sighting', {bubbles: true, composed: true, detail: this.sighting}));
  }

  private async onDelete(e: Event) {
    e.preventDefault();
    this.setMenuOpen(false);
    try {
      await deleteSighting(this.sighting.id);
    } catch (error) {
      reportError(this, "Couldn't delete that sighting. Please try again.", {cause: error});
      return;
    }
    // The row's removal must not wait for the next build.
    // <salish-sea> drops it from the list and refetches; see its handler.
    this.dispatchEvent(new CustomEvent('sighting-deleted', {bubbles: true, composed: true, detail: this.sighting.id}));
  }

  private async onEdit(e: Event) {
    e.preventDefault();
    this.setMenuOpen(false);
    this.dispatchEvent(new CustomEvent('edit-observation', {bubbles: true, composed: true, detail: this.sighting}));
  }
}

// What the word beside an unconfirmed sighting means, by the source's own rule (decision 080).
export function confirmationNote({confirmation, provider_slug}: Pick<Occurrence, 'confirmation' | 'provider_slug'>): string {
  if (confirmation === 'disputed') return 'The people who identified it on iNaturalist disagree about what it is';
  switch (provider_slug) {
    case 'inaturalist': return 'Nobody but the observer has identified it as this on iNaturalist yet';
    case 'maplify': return "Maplify hasn't marked this report trusted";
    case 'orcasound': return "Orcasound's moderators tagged the species as only possibly heard";
    default: return 'Nobody but the person who reported it has agreed with it yet';
  }
}

// Maplify comments embed the same provenance signals the resolver parses into
// the structured collection (see maplify.resolve_collection): a leading
// [bracket tag] and/or a trailing "Submitted by a <ORG> Trusted Observer …"
// line. Now that the sidebar renders the collection explicitly, strip both so
// the same fact isn't repeated as raw body text. Scoped to Maplify — other
// sources legitimately lead with a [label](url) markdown link.
export function stripResolvedProvenance(body: string, providerSlug: string | null): string {
  if (providerSlug !== 'maplify') return body;
  return body
    .replace(/^\s*\[[^\]]+\]\s*/, '')                            // leading bracket tag
    .replace(/\s*Submitted by an? .*?Trusted Observer.*$/is, '') // trailing attribution line
    .trim();
}

// Only http(s) URLs are safe to bind into an href. Provenance URLs are persisted
// record data, so a `javascript:` / `data:` scheme would otherwise become a
// clickable XSS sink; reject anything else and render plain text instead.
function safeExternalHref(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw, window.location.href);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : null;
  } catch {
    return null;
  }
}

// Share links always point at the map, regardless of which page (map or
// individual profile) hosts the summary.
export function buildShareUrl(occurrenceId: string): string {
  return `${window.location.origin}/?o=${occurrenceId}`;
}

export type CloneSightingEvent = CustomEvent<Occurrence>;
export type EditSightingEvent = CustomEvent<Occurrence>;
/** The id of a sighting the server has confirmed deleted. */
export type SightingDeletedEvent = CustomEvent<string>;

declare global {
  interface HTMLElementTagNameMap {
    "obs-summary": ObsSummary;
  }
}
