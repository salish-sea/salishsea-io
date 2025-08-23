import { css, LitElement, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SightingProperties } from "../types.ts";
import { html, unsafeStatic } from "lit/static-html.js";
import { tokenContext, userContext } from "./identity.ts";
import { consume } from "@lit/context";
import type { User } from "@auth0/auth0-spa-js";
import { when } from "lit/directives/when.js";

@customElement('obs-summary')
export class ObsSummary extends LitElement {
  @property({attribute: false})
  private sighting!: SightingProperties

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
    const {name, time, photos, source, symbol, userName, userSub, url} = this.sighting;
    const body = this.sighting.body ? unsafeStatic(this.sighting.body): undefined;
    const count = this.sighting.count && this.sighting.count > 0 ? html` <span class="count">x${this.sighting.count}</span>` : undefined;
    const canEdit = this.user && (userSub === this.user.sub);
    return html`
      <header>
        <a class="focus-sighting" @click="${this.focusSighting}" href="#">${symbol}</a>
        <b>${name}</b>${count}<time><a @click="${this.focusSighting}" href="#">${time}</a></time>
      </header>
      <cite>via${userName ? ` ${userName} on` : undefined} ${url ? html`<a target="_new" href=${url}>${source}</a>` : source}</cite>
      ${body}
      ${photos.length ?
        html`<ul class="photos">${
          photos.map(photo =>
            html`<li><a target="_new" href=${url || photo.url}><img alt=${photo.attribution} height="75" src=${photo.url}></a></li>`
          )
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
    const response = await fetch(this.sighting.path!, {headers: {Authorization: `Bearer ${this.authToken}`}, method: 'DELETE'});
    if (response.ok) {
      const evt = new CustomEvent('database-changed', {bubbles: true, composed: true});
      this.dispatchEvent(evt);
    } else {
      alert(response.statusText);
    }
  }
}

export type CloneSightingEvent = CustomEvent<SightingProperties>;

declare global {
  interface HTMLElementTagNameMap {
    "obs-summary": ObsSummary;
  }
}
