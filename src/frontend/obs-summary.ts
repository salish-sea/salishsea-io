import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SightingProperties } from "../types.ts";

@customElement('obs-summary')
export class ObsSummary extends LitElement {
  @property()
  sighting!: SightingProperties

  static styles = css`
    :host {
      display: block;
      line-height: 1.2rem;
    }
    :host(.focused) {
      background-color: #ffff5530;
    }
    header {
      margin-top: 1.5rem;
      overflow: auto;
    }
    time {
      float: right;
      font-size: 0.8rem;
      font-style: italic;
      line-height: 1.2rem;
    }
    cite {
      font-size: 0.8rem;
    }
    p {
      margin: 0.5rem 0 0;
    }
    .count {
      font-size: 0.8rem;
    }
    .focus-observation {
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
  `;

  public render() {
    const {name, time, photos, source, symbol, user, url} = this.sighting;
    const body = this.sighting.body?.split('\n') || [];
    const count = this.sighting.count && this.sighting.count > 0 ? html` <span class="count">x${this.sighting.count}</span>` : undefined;
    return html`
      <header>
        <a class="focus-observation" @click="${this.focusObservation}" href="#">${symbol}</a>
        <b>${name}</b>${count}<time>${time}</time>
      </header>
      <cite>via${user ? ` ${user} on` : undefined} ${url ? html`<a target="_new" href=${url}>${source}</a>` : source}</cite>
      ${body.map(p => html`<p class="body">${p}</p>`)}
      ${photos.length ?
        html`<ul class="photos">${
          photos.map(photo =>
            html`<li><a target="_new" href=${photo.url}><img alt=${photo.attribution} height="75" src=${photo.url}></a></li>`
          )
        }</ul>`
      : undefined}
    `
  }

  focusObservation(interaction: Event) {
    interaction.preventDefault();
    const focusObservation = new CustomEvent('focus-observation', {bubbles: true, composed: true, detail: this.sighting.id});
    this.dispatchEvent(focusObservation)
  }
}


declare global {
  interface HTMLElementTagNameMap {
    "obs-summary": ObsSummary;
  }
}
