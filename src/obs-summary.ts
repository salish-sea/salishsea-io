import { css, LitElement, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { html } from "lit/static-html.js";
import {unsafeHTML} from 'lit/directives/unsafe-html.js';
import { contributorContext, userContext, type User } from "./identity.ts";
import { consume } from "@lit/context";
import { when } from "lit/directives/when.js";
import { repeat } from "lit/directives/repeat.js";
import { symbolFor } from "./identifiers.ts";
import { marked } from 'marked';
import createDOMPurify from 'dompurify';
import { guard } from "lit/directives/guard.js";
import { Temporal } from "temporal-polyfill";
import { supabase } from "./supabase.ts";
import type { Contributor, Occurrence } from "./types.ts";
import { canEdit } from "./occurrence.ts";

const domPurify = createDOMPurify(window as any);

@customElement('obs-summary')
export class ObsSummary extends LitElement {
  @property({attribute: false})
  private sighting!: Occurrence

  @property({type: Boolean, reflect: true})
  private focused = false

  @property({type: Boolean, reflect: true, attribute: 'data-own-observation'})
  private ownObservation = false

  static styles = css`
    :host {
      border-left: 3px solid #cbd5e1;
      display: block;
      line-height: 1.5;
      margin-left: -0.5rem;
      margin-right: -0.5rem;
      padding: 1rem 0.5rem 1rem calc(0.5rem - 3px);
    }
    :host(.focused) {
      background-color: #e3f2fd;
      border-left-color: #1976d2;
    }
    :host([data-own-observation]) {
      background-color: rgba(128, 128, 128, 0.1);
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
    time a {
      color: inherit;
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
      attribution, body, count, id, observed_at, photos, taxon: {scientific_name, vernacular_name}, url
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
        <time><a @click="${this.focusSighting}" href="#${id}">${guard([observed_at], () => html`${
          Temporal.Instant.from(observed_at).toZonedDateTimeISO('PST8PDT').toPlainTime().toString({smallestUnit: 'minute', roundingMode: 'halfCeil'})
        }`)}</a></time>
      </header>
      <cite>via ${url ? html`<a target="_new" href=${url}>${attribution}</a>` : attribution}</cite>
      ${guard([body], () => html`${
        unsafeHTML(domPurify.sanitize(marked.parse(body?.replace(/(<br>\s*)+/, '\n\n') || '', {async: false})))
      }`)}
      ${photos?.length ?
        html`<ul class="photos">${
          repeat(photos, photo => photo.src, ({attribution, src, thumb}) => html`
            <li><a target="_new" href=${url || src}><img alt=${attribution || 'photo of subject'} height="75" src=${thumb || src}></a></li>
          `)
        }</ul>`
      : undefined}
      ${when(this.user || editable, () => html`
        <ul class="actions">
          ${when(this.user, () => html`
            <li><a href="#" @click=${this.onClone}>Clone</a></li>
          `)}
          ${when(editable, () => html`
            <li><a href="#" @click=${this.onEdit}>Edit</a></li>
            <li><a href="#" @click=${this.onDelete}>Delete</a></li>
          `)}
        </ul>
      `)}
    `
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
    if (error)
      throw new Error(`Error deleting observation: ${error}`);
    const evt = new CustomEvent('database-changed', {bubbles: true, composed: true});
    this.dispatchEvent(evt);
  }

  private async onEdit(e: Event) {
    e.preventDefault();
    this.dispatchEvent(new CustomEvent('edit-observation', {bubbles: true, composed: true, detail: this.sighting}));
  }
}

export type CloneSightingEvent = CustomEvent<Occurrence>;
export type EditSightingEvent = CustomEvent<Occurrence>;

declare global {
  interface HTMLElementTagNameMap {
    "obs-summary": ObsSummary;
  }
}
