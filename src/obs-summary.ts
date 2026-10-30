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
import { catalogCodes, ecotypeCodes, injectIndividualLinks, loadCatalogCodes, matrilineCodes, namedAnimals, podCodes, populationCodes } from './individual-links.ts';
import { openAnimalLinkInSidebar } from './subject.ts';
import { linkStyles } from './icons.ts';

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

/**
 * A sighting's text as a card shows it: Maplify's provenance taken out once it has been
 * read, partner and animal links put in, Markdown rendered and the result sanitized. A
 * segment's card shows its latest report's text the same way (salish-fwyt.5).
 */
export function sightingText(body: string | null | undefined, providerSlug: string | null | undefined) {
  return unsafeHTML(domPurify.sanitize(
    marked.parse(
      injectIndividualLinks(
        injectPartnerLinks(stripResolvedProvenance((body || '').replace(/(<br\s*\/?\s*>\s*)+/gi, '\n\n'), providerSlug ?? null)),
        catalogCodes() ?? new Map(),
        matrilineCodes() ?? new Map(),
        ecotypeCodes() ?? new Map()
      ),
      { async: false, renderer: markedRenderer }
    ),
    { ADD_ATTR: ['target', 'rel'] }
  ));
}

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

  static styles = [linkStyles, css`
    /* A card: each sighting one bordered object, the panel's gap between them
       (salish-fwyt.1, after the sidebar mockup). Set a step down the scale, at body2,
       as a list of many is: the sidebar is denser than anything Orcasound's design
       system sets, so this extends it (salish-hdhv). */
    :host {
      background-color: white;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      display: block;
      font-size: var(--fs-body2);
      line-height: 1.5;
      padding: 0.625rem 0.75rem;
    }
    :host([own-observation]) {
      background-color: var(--color-surface-tint);
    }
    :host(.focused) {
      background-color: var(--color-primary-tint);
      border-color: var(--color-primary);
    }
    header {
      align-items: baseline;
      display: flex;
      gap: 0.375rem;
      justify-content: space-between;
      position: relative;
    }
    .species-info {
      align-items: baseline;
      display: flex;
      flex-grow: 1;
      gap: 0.375rem;
    }
    /* The name, its count and its standing are one run of text, which wraps as a
       sentence does, so a long name has the count's room as well. The time keeps the
       heading's first line, on the right, where the cards line up as a timeline. */
    .title > :not(b) {
      white-space: nowrap;
    }
    time {
      color: var(--color-text-muted);
      font-family: var(--font-mono);
      font-size: var(--fs-mono);
      white-space: nowrap;
    }
    a {
      word-break: break-word;
    }
    /* Who saw it and through whom, quietly at the foot of the card. */
    cite {
      /* Light at 12px, the one exception to Regular there, in a darker grey that
         keeps its contrast: the lines read as thinner rather than paler (salish-hdhv). */
      color: var(--color-text-secondary);
      display: block;
      font-size: var(--fs-caption);
      font-weight: 300;
      font-style: normal;
      margin-top: 0.5rem;
    }
    /* The animals and groups the sighting names, as chips. They look like the
       tags on an Orcasound bout (orcasite's BoutTags, MUI's small chip): filled grey,
       or outlined and dashed for a tag only possibly heard, its hedge in words. There
       they are controls; here they are links to the animal's page, or plain where
       the catalogue has none. */
    ul.animals {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      list-style: none;
      margin: 0.375rem 0 0;
      padding: 0;
    }
    ul.animals li {
      background: var(--color-fill);
      border: 1px solid transparent;
      border-radius: 999px;
      box-sizing: border-box;
      color: var(--color-text);
      font-size: var(--fs-body2);
      line-height: 22px;
      padding: 0 8px;
      white-space: nowrap;
    }
    ul.animals li.possibly {
      background: transparent;
      border: 1px dashed var(--color-border-strong);
    }
    ul.animals li:has(a) {
      padding: 0;
    }
    /* A name with no page reads quieter than one that leads somewhere, since
       here, unlike on orcasite, a chip is a link only sometimes. */
    ul.animals li:not(:has(a)) {
      color: var(--color-text-muted);
    }
    ul.animals a {
      border-radius: 999px;
      color: inherit;
      display: block;
      padding: 0 8px;
      text-decoration: none;
    }
    ul.animals a:hover {
      background: var(--color-fill);
      color: inherit;
    }
    ul.animals a:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 1px;
    }
    /* The text's own grey, blue when pointed at; they leave the site, so the mark
       says they are links (linkStyles). */
    cite a {
      color: inherit;
    }
    cite a:hover {
      color: var(--color-primary);
    }
    cite .observer {
      color: var(--color-text-secondary);
    }
    .provider {
      /* Light at 12px, as cite is. */
      color: var(--color-text-secondary);
      display: block;
      font-size: var(--fs-caption);
      font-weight: 300;
      font-style: normal;
      margin-top: 0.125rem;
    }
    p {
      margin: 0.5rem 0 0;
    }
    p:last-child {
      margin-bottom: 0;
    }
    /* Where it was, under the name: the water region the build named (salish-fwyt.2), in
       the grey and Light of the card's other secondary lines, so its place sets it apart. */
    p.place {
      color: var(--color-text-secondary);
      margin-top: 0.25rem;
    }
    .count {
      color: var(--color-text-muted);
    }
    .focus-occurrence {
      /* The taxon colour is set inline, per occurrence. The white ring is what
         keeps a near-black orca dot from reading as a hole in the panel: the map's
         symbol, so its colours are data colours, not the interface's. */
      border: 2px solid #ffffff;
      border-radius: 50%;
      box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.25);
      display: inline-block;
      flex-shrink: 0;
      height: 0.75rem;
      /* Centred on the heading's first line, however many it takes. */
      align-self: flex-start;
      margin-top: calc((1.5em - 1rem) / 2);
      text-decoration: none;
      width: 0.75rem;
    }
    /* An unconfirmed sighting's dot is outlined, as on the map (decision 080). */
    .focus-occurrence.unconfirmed {
      border-color: var(--taxon-color);
    }
    .confirmation {
      color: var(--color-text-muted);
      font-style: italic;
    }
    .focus-occurrence:hover {
      /* The symbol's ring, darker: a data colour. */
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
       button keeps its 44px touch target while centred on the heading's first line. */
    .more {
      align-self: flex-start;
      background: transparent;
      border: 0;
      border-radius: 4px;
      color: var(--color-text-muted);
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
      color: var(--color-text);
    }
    .more:hover .dots, .more[aria-expanded="true"] .dots {
      background: var(--color-fill);
    }
    .more:focus-visible {
      outline: 2px solid var(--color-primary);
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
      border: 1px solid var(--color-border);
      border-radius: 8px;
      box-shadow: var(--shadow-popover);
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
      color: var(--color-text);
      cursor: pointer;
      display: block;
      font: inherit;
      font-size: var(--fs-body2);
      font-weight: 400;
      min-height: 40px;
      padding: 8px 16px;
      text-align: left;
      width: 100%;
    }
    .menu button:hover {
      background: var(--color-fill);
    }
    .menu button:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: -2px;
    }
    .menu button.danger {
      color: var(--color-error);
    }
  `];

  @consume({context: userContext, subscribe: true})
  private user: User | undefined;

  @consume({context: contributorContext, subscribe: true})
  private contributor: Contributor | undefined;

  constructor() {
    super();
    this.addEventListener('click', openAnimalLinkInSidebar);
  }

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
      body, confirmation, count, disagreements, identifiers, observed_at, photos, place, provider_slug, taxon, url, vitality
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
          <span class="title"><b>${name}</b>${
            when(count && count > 0, () => html` <span class="count">×${count}</span>`)}${
            when(unconfirmed, () => html` <span class="confirmation" title=${confirmationNote(this.sighting)}>${confirmation === 'disputed' ? 'Disputed' : 'Unconfirmed'}</span>`)}${
            when(vitality === 'dead', () => html` <span class="confirmation" title="Annotated dead on iNaturalist: a stranded or floating animal, not one travelling">Dead</span>`)}${
            when(!unconfirmed && disagreements, () => html` <span class="confirmation" title="Confirmed: at least two thirds of the others who identified it agree">${disagreements === 1 ? '1 identifier disagrees' : `${disagreements} identifiers disagree`}</span>`)}</span>
        </div>
        <time>${guard([observed_at], () => html`${
          Temporal.Instant.from(observed_at).toZonedDateTimeISO('America/Los_Angeles').toPlainTime().toString({smallestUnit: 'minute', roundingMode: 'halfCeil'})
        }`)}</time>
        <button class="more" type="button" aria-haspopup="menu" aria-expanded=${this.menuOpen ? 'true' : 'false'}
          aria-label="Actions for this sighting" title="Actions" @pointerdown=${this.onTriggerPress} @click=${this.toggleMenu}>
          <svg class="dots" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" fill="currentColor" aria-hidden="true">
            <circle cx="4" cy="10" r="1.6"></circle><circle cx="10" cy="10" r="1.6"></circle><circle cx="16" cy="10" r="1.6"></circle>
          </svg>
        </button>
        ${this.menuOpen ? this.renderMenu(editable) : nothing}
      </header>
      ${place ? html`<p class="place">${place}</p>` : nothing}
      ${guard([identifiers, this.catalogLoaded], () => {
        const animals = namedAnimals(identifiers, catalogCodes() ?? new Map(), matrilineCodes() ?? new Map(), populationCodes() ?? new Map(), podCodes() ?? new Map());
        return animals.length ? html`<ul class="animals">${animals.map(({label, href, possibly}) => {
          const text = possibly ? `${label} (possibly)` : label;
          return html`<li class=${possibly ? 'possibly' : ''}>${href ? html`<a href=${href}>${text}</a>` : text}</li>`;
        })}</ul>` : nothing;
      })}
      ${guard([body, this.catalogLoaded], () => html`${sightingText(body, provider_slug)}`)}
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
      <div class="menu" role="menu" aria-label="Actions for this sighting" @keydown=${this.onMenuKeydown} @focusout=${this.onMenuFocusout}>
        <button type="button" role="menuitem" tabindex="-1" @click=${this.onCopyLink}>${this.copied ? 'Copied!' : 'Copy link'}</button>
        ${when(this.user, () => html`<button type="button" role="menuitem" tabindex="-1" @click=${this.onClone}>Clone</button>`)}
        ${when(editable, () => html`
          <button type="button" role="menuitem" tabindex="-1" @click=${this.onEdit}>Edit</button>
          <button type="button" role="menuitem" tabindex="-1" class="danger" @click=${this.onDelete}>Delete</button>
        `)}
      </div>
    `;
  }

  // The page is listened to only while this card's menu is open: a day can hold
  // a hundred cards, and each would otherwise hear every click.
  // The click is left to reach the page, so another card's open menu hears it and
  // closes; this card's own listener ignores clicks on its menu and its button.
  private toggleMenu = () => {
    this.triggerPressed = false;
    this.setMenuOpen(!this.menuOpen);
  };

  // A press on the button moves focus from an item to the button before its click
  // arrives. The menu leaves the closing to that click, which would otherwise find
  // the menu already closed by the focus move and open it again.
  private triggerPressed = false;
  private onTriggerPress = () => {
    this.triggerPressed = true;
  };

  // Closing removes the menu, and a focused element that is removed leaves focus on
  // the page, so a keyboard user would lose their place: when focus is in the menu
  // as it closes, it goes back to the menu's button.
  private setMenuOpen(open: boolean, returnFocus = this.focusInMenu()) {
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

  private focusInMenu(): boolean {
    const focused = this.shadowRoot?.activeElement;
    return !!focused && !!this.shadowRoot?.querySelector('.menu')?.contains(focused);
  }

  private menuItems(): HTMLButtonElement[] {
    return [...this.shadowRoot?.querySelectorAll<HTMLButtonElement>('.menu [role="menuitem"]') ?? []];
  }

  // Any click but one on the menu or its button closes it, elsewhere on this card included.
  private onDocumentClick = (event: MouseEvent) => {
    const path = event.composedPath();
    const menu = this.shadowRoot?.querySelector('.menu');
    const trigger = this.shadowRoot?.querySelector('.more');
    if (!(menu && path.includes(menu)) && !(trigger && path.includes(trigger))) this.setMenuOpen(false);
  };

  private onDocumentKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') this.setMenuOpen(false, true);
  };

  // Up and down move between the items, wrapping; Home and End go to the ends. The
  // items are out of the Tab order, as a menu's are, so Tab takes focus past the menu.
  private onMenuKeydown = (event: KeyboardEvent) => {
    const items = this.menuItems();
    const at = items.indexOf(this.shadowRoot?.activeElement as HTMLButtonElement);
    const to = {ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1}[event.key];
    if (to !== undefined) {
      event.preventDefault();
      items[(to + items.length) % items.length]?.focus();
    }
  };

  // The menu closes once focus has gone somewhere else, as Tab takes it: after the
  // move, not on the key, which would remove the focused item before the browser
  // could move focus on. A focusout with nowhere to go, as when a click lands on
  // something that takes no focus, is left to the page's click listener, or a click
  // on an item in a browser that doesn't focus buttons would close the menu first.
  private onMenuFocusout = (event: FocusEvent) => {
    const to = event.relatedTarget as Node | null;
    if (!to || (event.currentTarget as HTMLElement).contains(to)) return;
    if (this.triggerPressed && to === this.shadowRoot?.querySelector('.more')) return;
    this.setMenuOpen(false, false);
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
