import { css, html, LitElement} from "lit";
import { customElement, property } from "lit/decorators.js";
import { live } from 'lit/directives/live.js';
import { keyed } from 'lit/directives/keyed.js';
import { Temporal } from "temporal-polyfill";
import './sighting-form.ts';
import { cameraAddIcon } from "./icons.ts";
import { consume } from "@lit/context";
import { doLogInContext, tokenContext } from "./identity.ts";
import { classMap } from "lit/directives/class-map.js";
import { newSighting } from "./sighting-form.ts";
import { v7 } from "uuid";

const today = Temporal.Now.plainDateISO().toString();

@customElement('obs-panel')
export class ObsPanel extends LitElement {
  static styles = css`
    :host {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      font-family: Mukta,Helvetica,Arial,sans-serif;
      gap: 1rem;
      overflow: clip scroll;
      scroll-behavior: smooth;
    }
    .full-bleed {
      align-self: stretch;
      margin-left: -0.5rem;
      margin-right: -0.5rem;
    }
    header {
      text-align: center;
    }
    h2 {
      font-size: 1.5rem;
      font-weight: 400;
      margin-bottom: 0;
      margin-top: 1rem;
    }
    input[type=date] {
      -webkit-min-logical-width: 5rem;
    }
    button {
      align-items: center;
      align-self: flex-start;
      cursor: pointer;
      display: inline-flex;
      gap: 0.5rem;
      vertical-align: middle;
    }
    button[name=show] {
      background-color: rgb(27, 43, 123);
      border: none;
      border-radius: 4px;
      color: white;
      fill: white;
      font-weight: 500;
      padding: 1rem;
      text-transform: uppercase;
    }
    sighting-form {
      background-color: rgba(128, 128, 128, 0.1);
    }
    .hide {
      display: none;
    }
  `;

  @property({attribute: true, reflect: true, type: Boolean})
  public showForm: boolean = false

  @property({type: String, reflect: true})
  private date!: string;

  @consume({context: tokenContext, subscribe: true})
  private token: string | undefined;

  @consume({context: doLogInContext})
  private logIn!: () => Promise<boolean>;

  #sightingForForm = {...newSighting(), id: v7()};

  protected render() {
    const {id, ...sighting} = this.#sightingForForm;
    return html`
      <header>
        <h2>Marine Mammal Observations</h2>
        <form>
          <input @click=${this.onGotoYesterday} type="button" name="yesterday" value="◀">
          <input @click=${this.onGotoTomorrow}  type="button" name="tomorrow" value="▶" ?disabled=${this.date === today}>
          <input @change=${this.onDateChange} max=${today} min="2000-01-01" type="date" .value=${live(this.date)}>
        </form>
      </header>
      ${keyed(this.#sightingForForm, html`
        <sighting-form
          class=${classMap({"full-bleed": true, hide: !this.showForm})}
          @cancel-edit=${this.onCancelEdit}
          @sighting-saved=${this.onSightingSaved}
          .initialValues=${sighting}
          sightingId=${id}
          date=${this.date}
        ></sighting-form>
      `)}
      <button class=${classMap({hide: this.showForm})} @click=${this.doShowForm} type="button" name="show">
        <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px">${cameraAddIcon}</svg>
        <span>Add a Sighting</span>
      </button>
      <slot></slot>
    `;
  }

  private onCancelEdit() {
    this.showForm = false;
    this.#sightingForForm = {...newSighting(), id: v7()};
  }

  private onSightingSaved() {
    this.showForm = false;
    this.#sightingForForm = {...newSighting(), id: v7()};
  }

  private onGotoYesterday() {
    const date = Temporal.PlainDate.from(this.date).subtract({days: 1});
    const dateSelected = new CustomEvent('date-selected', {bubbles: true, composed: true, detail: date.toString()})
    this.dispatchEvent(dateSelected);
  }

  private onGotoTomorrow() {
    const date = Temporal.PlainDate.from(this.date).add({days: 1});
    const dateSelected = new CustomEvent('date-selected', {bubbles: true, composed: true, detail: date.toString()})
    this.dispatchEvent(dateSelected);
  }

  private onDateChange(e: Event) {
    const date = (e.target as HTMLInputElement).value;
    if (date && date.match(/^20\d\d-\d\d-\d\d$/)) {
      const dateSelected = new CustomEvent('date-selected', {bubbles: true, composed: true, detail: date})
      this.dispatchEvent(dateSelected);
    }
  }

  private async doShowForm() {
    if (!this.token) {
      const success = await this.logIn();
      if (!success)
        return;
      // Allow context subscription a microtask to propagate the token.
      await Promise.resolve();
    }
    if (!this.token)
      throw new Error("Login succeeded but token was not available");

    this.showForm = true;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "obs-panel": ObsPanel;
  }
}
