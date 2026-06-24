import { css, LitElement, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { html } from "lit/static-html.js";
import {unsafeHTML} from 'lit/directives/unsafe-html.js';
import { contributorContext, userContext, type User } from "./identity.ts";
import { consume } from "@lit/context";
import { when } from "lit/directives/when.js";
import { repeat } from "lit/directives/repeat.js";
import { symbolFor } from "./identifiers.ts";
import { marked, Renderer } from 'marked';
import createDOMPurify from 'dompurify';
import { guard } from "lit/directives/guard.js";
import { Temporal } from "temporal-polyfill";
import { supabase } from "./supabase.ts";
import type { Contributor, Occurrence } from "./types.ts";
import { canEdit } from "./occurrence.ts";
import { injectPartnerLinks } from './partner-links.ts';

const domPurify = createDOMPurify(window as any);

const markedRenderer = new Renderer();
markedRenderer.link = ({ href, text }: { href: string; text: string }) =>
  `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;

@customElement('obs-summary')
export class ObsSummary extends LitElement {
  @property({attribute: false})
  private sighting!: Occurrence

  @property({type: Boolean, reflect: true})
  private focused = false

  @property({type: Boolean, reflect: true, attribute: 'own-observation'})
  protected ownObservation = false

  @state() private copied = false;

  static styles = css`
    :host {
      border-left: 3px solid #cbd5e1;
      display: block;
      line-height: 1.5;
      margin-left: -0.5rem;
      margin-right: -0.5rem;
      padding: 1rem 0.5rem 1rem calc(0.5rem - 3px);
    }
    :host([own-observation]) {
      background-color: rgba(128, 128, 128, 0.1);
    }
    :host(.focused) {
      background-color: #e3f2fd;
      border-left-color: #1976d2;
    }
    header {
      align-items: baseline;
      display: flex;
      gap: 0.5rem;
      justify-content: space-between;
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
    cite {
      color: #64748b;
      display: block;
      font-size: 0.8125rem;
      margin-top: 0.25rem;
    }
    cite a {
      color: inherit;
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
      border: 1px solid #1976d2;
      border-radius: 50%;
      color: #1976d2;
      display: inline-block;
      flex-shrink: 0;
      font-family: monospace;
      font-weight: bold;
      height: 1rem;
      line-height: 1rem;
      text-align: center;
      text-decoration: none;
      width: 1rem;
    }
    .focus-occurrence:hover {
      background-color: #e3f2fd;
      border-color: #1565c0;
      color: #1565c0;
    }
    ul.photos {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      list-style: none;
      margin: 1rem 0 0 0;
      padding: 0;
    }
    ul.actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      justify-content: flex-end;
      list-style: none;
      margin: 1rem 0 0 0;
      padding: 0;
    }
    ul.actions a {
      background: white;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      color: #334155;
      font-size: 0.8125rem;
      padding: 0.25rem 0.5rem;
    }
    ul.actions a:hover {
      background: #f1f5f9;
      color: #1e293b;
    }
  `;

  @consume({context: userContext, subscribe: true})
  private user: User | undefined;

  @consume({context: contributorContext, subscribe: true})
  private contributor: Contributor | undefined;

  protected willUpdate(changedProperties: PropertyValues): void {
    if (changedProperties.has('contributor') || changedProperties.has('sighting')) {
      this.ownObservation = !!(this.contributor && this.sighting.contributor_id === this.contributor.id);
    }
  }

  public render() {
    const {
      body, count, observed_at, photos, provider_slug, taxon: {scientific_name, vernacular_name}, url
    } = this.sighting;
    const symbol = symbolFor(this.sighting);
    const name = vernacular_name || scientific_name;
    const editable = this.contributor && canEdit(this.sighting, this.contributor) || false;

    return html`
      <header>
        <div class="species-info">
          <a class="focus-occurrence" @click="${this.focusSighting}" href="#" title="Focus on map">${symbol}</a>
          <b>${name}</b>
          ${when(count && count > 0, () => html`<span class="count">×${count}</span>`)}
        </div>
        <time>${guard([observed_at], () => html`${
          Temporal.Instant.from(observed_at).toZonedDateTimeISO('PST8PDT').toPlainTime().toString({smallestUnit: 'minute', roundingMode: 'halfCeil'})
        }`)}</time>
      </header>
      ${this.renderProvenance()}
      ${guard([body], () => html`${
        unsafeHTML(domPurify.sanitize(
          marked.parse(
            injectPartnerLinks(stripResolvedProvenance((body || '').replace(/(<br\s*\/?\s*>\s*)+/gi, '\n\n'), provider_slug)),
            { async: false, renderer: markedRenderer }
          ),
          { ADD_ATTR: ['target', 'rel'] }
        ))
      }`)}
      ${photos?.length ?
        html`<ul class="photos">${
          repeat(photos, photo => photo.src, ({attribution, src, thumb}) => html`
            <li><a target="_blank" href=${url || src}><img alt=${attribution || 'photo of subject'} height="75" src=${thumb || src}></a></li>
          `)
        }</ul>`
      : undefined}
      <ul class="actions">
        <li><a href="#" @click=${this.onCopyLink}>${this.copied ? 'Copied!' : 'Copy link'}</a></li>
        ${when(this.user, () => html`
          <li><a href="#" @click=${this.onClone}>Clone</a></li>
        `)}
        ${when(editable, () => html`
          <li><a href="#" @click=${this.onEdit}>Edit</a></li>
          <li><a href="#" @click=${this.onDelete}>Delete</a></li>
        `)}
      </ul>
    `
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
    // i.e. Maplify behind an Orca Network sighting, not "via iNaturalist / iNaturalist".
    const showProvider = provider && collection && provider !== collection;
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
    setTimeout(() => { this.copied = false; }, 2000);
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
    this.dispatchEvent(new CustomEvent('clone-sighting', {bubbles: true, composed: true, detail: this.sighting}));
  }

  private async onDelete(e: Event) {
    e.preventDefault();
    const {error} = await supabase().from('observations').delete().eq('id', this.sighting.id);
    if (error) {
      console.error('Error deleting observation:', error);
      // TODO: surface to user via a toast/state property
      return;
    }
  }

  private async onEdit(e: Event) {
    e.preventDefault();
    this.dispatchEvent(new CustomEvent('edit-observation', {bubbles: true, composed: true, detail: this.sighting}));
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

export function buildShareUrl(occurrenceId: string): string {
  return `${window.location.origin}${window.location.pathname}?o=${occurrenceId}`;
}

export type CloneSightingEvent = CustomEvent<Occurrence>;
export type EditSightingEvent = CustomEvent<Occurrence>;

declare global {
  interface HTMLElementTagNameMap {
    "obs-summary": ObsSummary;
  }
}
