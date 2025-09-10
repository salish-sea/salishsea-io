import { css, LitElement, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { html } from "lit/static-html.js";
import { tokenContext, userContext } from "./identity.ts";
import { consume } from "@lit/context";
import type { User } from "@auth0/auth0-spa-js";
import { when } from "lit/directives/when.js";
import type { Sighting } from "../sighting.ts";
import { repeat } from "lit/directives/repeat.js";

@customElement('obs-summary')
export class ObsSummary extends LitElement {
  @property({attribute: false})
  private sighting!: Sighting

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

  @consume({context: tokenContext, subscribe: true})
  private authToken: string | undefined;

  public render() {
    const {
      attribution, body, count, id, observed_at, photos, symbol, taxon: {scientific_name, vernacular_name}
    } = this.sighting;
    // const body = this.sighting.body ? unsafeStatic(this.sighting.body): undefined;
    const canEdit = id.startsWith('/');
    const url = id.startsWith('http') ? id : undefined;
    const name = vernacular_name || scientific_name;
    return html`
      <header>
        <a class="focus-sighting" @click="${this.focusSighting}" href="#">${symbol}</a>
        <b>${name}</b>${when(
          count && count > 0,
          () => html`<span class="count">x${this.sighting.count}</span>`)
          }<time><a @click="${this.focusSighting}" href="#">${observed_at}</a></time>
      </header>
      <cite>via ${url ? html`<a target="_new" href=${url}>${attribution}</a>` : attribution}</cite>
      ${body}
      ${photos.length ?
        html`<ul class="photos">${
          repeat(photos, photo => photo.src, ({attribution, src, thumb}) => html`
            <li><a target="_new" href=${url || src}><img alt=${attribution || 'photo of subject'} height="75" src=${thumb || src}></a></li>
          `)
        }</ul>`
      : undefined}
      <ul class="actions">
        <li><a href="#" @click=${this.onClone}>Clone</a></li>
        ${when(canEdit, () => html`
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
    const response = await fetch(this.sighting.id, {headers: {Authorization: `Bearer ${this.authToken}`}, method: 'DELETE'});
    if (response.ok) {
      const evt = new CustomEvent('database-changed', {bubbles: true, composed: true});
      this.dispatchEvent(evt);
    } else {
      alert(response.statusText);
    }
  }
}

export type CloneSightingEvent = CustomEvent<Sighting>;

declare global {
  interface HTMLElementTagNameMap {
    "obs-summary": ObsSummary;
  }
}
