import { css, html, LitElement} from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { live } from 'lit/directives/live.js';
import { Temporal } from "temporal-polyfill";
import './add-sighting.ts';
import { cameraAddIcon } from "./icons.ts";

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
    add-sighting {
      background-color: rgba(128, 128, 128, 0.1);
    }
  `;

  @state()
  private _showForm: boolean = false

  @property({type: String, reflect: true})
  private date!: string;

  protected render() {
    return html`
      <header>
        <h2>Marine Mammal Observations</h2>
        <form>
          <input @click=${this.onGotoYesterday} type="button" name="yesterday" value="◀">
          <input @click=${this.onGotoTomorrow}  type="button" name="tomorrow" value="▶" ?disabled=${this.date === today}>
          <input @change=${this.onDateChange} max=${today} min="2000-01-01" type="date" .value=${live(this.date)}>
        </form>
      </header>
      ${this._showForm ? html`
        <add-sighting class="full-bleed" .cancel=${this.hideForm.bind(this)} .date=${this.date}></add-sighting>
      ` : html`
        <button @click=${this.showForm} type="button" name="show">
          <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px">${cameraAddIcon}</svg>
          <span>Add a Sighting</span>
        </button>
      `}
      <slot></slot>
    `;
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

  private hideForm() {
    this._showForm = false;
  }

  private showForm() {
    this._showForm = true;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "obs-panel": ObsPanel;
  }
}
