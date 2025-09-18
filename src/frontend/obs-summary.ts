import { css, LitElement, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { html, unsafeStatic } from "lit/static-html.js";
import { userContext, type User } from "./identity.ts";
import { consume } from "@lit/context";
import { when } from "lit/directives/when.js";
import { repeat } from "lit/directives/repeat.js";
import { symbolFor } from "../identifiers.ts";
import { marked } from 'marked';
import createDOMPurify from 'dompurify';
import { guard } from "lit/directives/guard.js";
import { Temporal } from "temporal-polyfill";
import { supabase, type Occurrence } from "./supabase.ts";

const domPurify = createDOMPurify(window as any);

@customElement('obs-summary')
export class ObsSummary extends LitElement {
  @property({attribute: false})
  private sighting!: Occurrence

  @property({type: Boolean, reflect: true})
  private focused = false

  static styles = css`
    :host {
      display: block;
      line-height: 1.2rem;
    }
    :host(.focused) {
      background-color: #ffff5530;
    }
    header {
      overflow: auto;
    }
    time {
      float: right;
      font-size: 0.8rem;
      font-style: italic;
      line-height: 1.2rem;
    }
    a {
      text-decoration: none;
    }
    cite {
      font-size: 0.8rem;
    }
    p {
      margin: 0.5rem 0 0;
    }
    a {
      word-break: break-word;
    }
    .count {
      font-size: 0.8rem;
    }
    .focus-sighting {
      border: 1px solid #3399CC;
      border-radius: 50%;
      color: inherit;
      display: inline-block;
      font-family: monospace;
      font-weight: bold;
      height: 0.8rem;
      line-height: 0.8rem;
      text-align: center;
      text-decoration: none;
      width: 0.8rem;
    }
    ul.photos {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      list-style: none;
      margin: 0.5rem 0 0 0;
      padding: 0;
    }
    ul.actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      list-style: none;
      margin: 0.5rem 0 0 0;
      padding: 0;
    }
  `;

  @consume({context: userContext, subscribe: true})
  private user: User | undefined;

  public render() {
      const {
      attribution, body, count, id, observed_at, photos, taxon: {scientific_name, vernacular_name}, url, is_own_observation
    } = this.sighting;
    const symbol = symbolFor(this.sighting);
    const name = vernacular_name || scientific_name;

    return html`
      <header>
        <a class="focus-sighting" @click="${this.focusSighting}" href="#">${symbol}</a>
        <b>${name}</b>${when(
          count && count > 0,
          () => html` <span class="count">x${this.sighting.count}</span>`)
          }<time><a @click="${this.focusSighting}" href="#${id}">${guard([observed_at], () => html`${
            Temporal.Instant.from(observed_at).toZonedDateTimeISO('PST8PDT').toPlainTime().toString({smallestUnit: 'minute', roundingMode: 'halfCeil'})
          }`)}</a></time>
      </header>
      <cite>via ${url ? html`<a target="_new" href=${url}>${attribution}</a>` : attribution}</cite>
      ${guard([body], () => html`${
        unsafeStatic(domPurify.sanitize(marked.parse(body?.replace(/^(<br>)+/, '') || '', {async: false})))
      }`)}
      ${photos?.length ?
        html`<ul class="photos">${
          repeat(photos, photo => photo.src, ({attribution, src, thumb}) => html`
            <li><a target="_new" href=${url || src}><img alt=${attribution || 'photo of subject'} height="75" src=${thumb || src}></a></li>
          `)
        }</ul>`
      : undefined}
      <ul class="actions">
        ${when(this.user, () => html`
          <li><a href="#" @click=${this.onClone}>Clone</a></li>
        `)}
        ${when(is_own_observation, () => html`
          <li><a href="#" @click=${this.onDelete}>Delete</a></li>
        `)}
      </ul>
    `
  }

  private focusSighting(interaction: Event) {
    interaction.preventDefault();
    const focusSighting = new CustomEvent('focus-sighting', {bubbles: true, composed: true, detail: this.sighting.id});
    this.dispatchEvent(focusSighting)
  }

  protected willUpdate(changedProperties: PropertyValues): void {
    if (changedProperties.has('focused') && this.focused)
      this.scrollIntoView({block: 'center'});
  }

  private async onClone(e: Event) {
    e.preventDefault();
    this.dispatchEvent(new CustomEvent('clone-sighting', {bubbles: true, composed: true, detail: this.sighting}));
  }

  private async onDelete(e: Event) {
    e.preventDefault();
    const {error} = await supabase.from('observations').delete().eq('id', this.sighting.id);
    if (error)
      throw new Error(`Error deleting observation: ${error}`);
    const evt = new CustomEvent('database-changed', {bubbles: true, composed: true});
    this.dispatchEvent(evt);
  }
}

export type CloneSightingEvent = CustomEvent<Occurrence>;

declare global {
  interface HTMLElementTagNameMap {
    "obs-summary": ObsSummary;
  }
}
