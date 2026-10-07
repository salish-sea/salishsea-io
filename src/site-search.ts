/**
 * The site's search field (GH #640), in the nav on every page: one query field for every
 * named thing, as BeeAtlas's is (its ADR 0021). It finds what src/search.ts says, from
 * the index the read-path build writes (scripts/read-path/search-index.ts), fetched the
 * first time the field is focused, so a page that is never searched never loads it.
 *
 * A result is a link. An animal offers two: its page, and beneath it its most recent
 * sighting on the map (Peter, 2026-10-07); one never sighted offers only its page. The
 * list is an ARIA combobox: arrows move through every link, Enter follows the one
 * marked, Escape closes the list.
 *
 * On a phone there is no room in the nav for a field, so it is a button that opens the
 * field across the top of the screen.
 *
 * A prerendered page loads this as an island (scripts/read-path/profiles.ts); the
 * client-rendered pages import it.
 */

import { css, html, LitElement, nothing, svg } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { search, type SearchEntry, type SearchIndex } from './search.ts';

/** Where the build's files are served: src/read-path.ts's READ_PATH_BASE, not imported, to keep this island small. */
const INDEX_URL = '/read-path/search-index.json';

/** One link in the list: a result's page, or an animal's most recent sighting. */
type Option = { entry: SearchEntry; latest: boolean; href: string };

const KIND_LABELS: Record<SearchEntry['kind'], string> = {
  individual: 'Whale', matriline: 'Matriline', population: 'Population', haulout: 'Haul-out site', region: 'Map region',
};

let indexRequest: Promise<SearchEntry[]> | null = null;

/** The index, fetched once per page however many fields there are; a failure is retried on the next focus. */
function loadIndex(): Promise<SearchEntry[]> {
  indexRequest ??= fetch(INDEX_URL)
    .then(response => {
      if (!response.ok) throw new Error(`${INDEX_URL}: ${response.status}`);
      return response.json() as Promise<SearchIndex>;
    })
    .then(index => index.entries)
    .catch(error => {
      indexRequest = null;
      throw error;
    });
  return indexRequest;
}

/** "Oct 6, 2026", from a Pacific calendar date. Noon, so no time zone moves it to another day. */
function formatDay(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const searchIcon = svg`<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"></circle><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>`;

@customElement('site-search')
export class SiteSearch extends LitElement {
  static styles = css`
    :host {
      display: block;
      font: inherit;
      position: relative;
    }
    .toggle, .close {
      display: none;
    }
    input {
      background: white;
      border: 1px solid var(--site-search-border, #cbd5e1);
      border-radius: 6px;
      box-sizing: border-box;
      color: #0f172a;
      font: inherit;
      font-size: 0.95rem;
      padding: 0.35rem 0.6rem;
      width: 100%;
    }
    input:focus {
      border-color: #1976d2;
      outline: 2px solid rgba(25, 118, 210, 0.3);
    }
    ul {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.18);
      box-sizing: border-box;
      list-style: none;
      margin: 0.25rem 0 0;
      max-height: min(70vh, 32rem);
      min-width: 100%;
      overflow-y: auto;
      padding: 0.25rem 0;
      position: absolute;
      right: 0;
      width: max-content;
      max-width: min(26rem, 92vw);
      z-index: 1000;
    }
    li a {
      color: #0f172a;
      display: block;
      padding: 0.4rem 0.75rem;
      text-decoration: none;
    }
    li a.latest {
      color: #1565c0;
      font-size: 0.875rem;
      padding: 0.15rem 0.75rem 0.45rem 1.75rem;
    }
    li[aria-selected="true"] a {
      background: #e3f2fd;
    }
    .label {
      font-weight: 600;
    }
    .note {
      color: #64748b;
      display: block;
      font-size: 0.8rem;
    }
    .message {
      color: #64748b;
      font-size: 0.875rem;
      padding: 0.4rem 0.75rem;
    }
    /* A phone: a button in the nav, and the field across the top of the screen. */
    @media (max-width: 40rem) {
      .toggle {
        align-items: center;
        background: none;
        border: 0;
        color: inherit;
        cursor: pointer;
        display: inline-flex;
        padding: 0.125rem;
      }
      .field {
        display: none;
      }
      .field.open {
        align-items: flex-start;
        background: white;
        box-shadow: 0 4px 16px rgba(15, 23, 42, 0.25);
        box-sizing: border-box;
        display: flex;
        gap: 0.5rem;
        left: 0;
        padding: 0.5rem;
        position: fixed;
        right: 0;
        top: 0;
        z-index: 1000;
      }
      .field.open .box {
        flex: 1;
        position: relative;
      }
      .close {
        background: none;
        border: 0;
        color: #1976d2;
        cursor: pointer;
        display: block;
        font: inherit;
        padding: 0.4rem 0.25rem;
      }
      ul {
        left: 0;
        max-width: none;
        width: 100%;
      }
    }
  `;

  @state() private query = '';
  @state() private entries: SearchEntry[] | null = null;
  @state() private failed = false;
  @state() private active = -1;
  @state() private listOpen = false;
  /** The phone's sheet. */
  @state() private sheetOpen = false;

  @query('input') private input!: HTMLInputElement;

  private get options(): Option[] {
    if (!this.entries) return [];
    return search(this.entries, this.query).flatMap(entry => [
      { entry, latest: false, href: entry.href },
      ...(entry.latest ? [{ entry, latest: true, href: entry.latest.href }] : []),
    ]);
  }

  private onFocus() {
    this.listOpen = true;
    if (this.entries) return;
    loadIndex().then(entries => {
      this.entries = entries;
      this.failed = false;
    }, () => {
      this.failed = true;
    });
  }

  private onInput(event: InputEvent) {
    this.query = (event.target as HTMLInputElement).value;
    this.active = this.query.trim() ? 0 : -1;
    this.listOpen = true;
  }

  private onKeydown(event: KeyboardEvent) {
    const options = this.options;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!options.length) return;
      this.listOpen = true;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.active = (this.active + step + options.length) % options.length;
    } else if (event.key === 'Enter') {
      const option = options[this.active] ?? options[0];
      if (option) {
        event.preventDefault();
        window.location.assign(option.href);
      }
    } else if (event.key === 'Escape') {
      if (this.listOpen && this.query) this.listOpen = false;
      else this.closeSheet();
    }
  }

  /** Close the list when focus leaves the field and its list for something else on the page. */
  private onFocusout(event: FocusEvent) {
    if (!this.renderRoot.contains(event.relatedTarget as Node | null)) {
      this.listOpen = false;
      this.sheetOpen = false;
    }
  }

  private async openSheet() {
    this.sheetOpen = true;
    await this.updateComplete;
    this.input.focus();
  }

  private closeSheet() {
    this.sheetOpen = false;
    this.listOpen = false;
  }

  protected render() {
    const options = this.options;
    const showList = this.listOpen && this.query.trim() !== '';
    return html`
      <button class="toggle" type="button" aria-label="Search whales and places" aria-expanded=${this.sheetOpen ? 'true' : 'false'}
        @click=${this.openSheet}>${searchIcon}</button>
      <div class="field ${this.sheetOpen ? 'open' : ''}" @focusout=${this.onFocusout}>
        <div class="box">
          <input type="search" role="combobox" aria-label="Search whales and places" placeholder="Search whales and places"
            autocomplete="off" spellcheck="false" aria-autocomplete="list" aria-controls="results"
            aria-expanded=${showList ? 'true' : 'false'}
            aria-activedescendant=${showList && this.active >= 0 && options[this.active] ? `option-${this.active}` : nothing}
            .value=${this.query} @focus=${this.onFocus} @input=${this.onInput} @keydown=${this.onKeydown}>
          ${showList ? this.renderList(options) : nothing}
        </div>
        <button class="close" type="button" @click=${this.closeSheet}>Cancel</button>
      </div>
    `;
  }

  private renderList(options: Option[]) {
    if (this.failed) return html`<ul id="results" role="listbox"><li class="message" role="presentation">Search isn't available right now.</li></ul>`;
    if (!this.entries) return html`<ul id="results" role="listbox"><li class="message" role="presentation">Loading…</li></ul>`;
    if (!options.length) return html`<ul id="results" role="listbox"><li class="message" role="presentation">Nothing by that name.</li></ul>`;
    // mousedown would take focus from the field, and the list would close before the click landed.
    return html`<ul id="results" role="listbox" aria-label="Results" @mousedown=${(e: MouseEvent) => e.preventDefault()}>
      ${options.map((option, i) => html`
        <li id=${`option-${i}`} role="option" aria-selected=${i === this.active ? 'true' : 'false'}
          @mouseenter=${() => { this.active = i; }}>
          ${option.latest
            ? html`<a class="latest" href=${option.href} tabindex="-1">Latest sighting · ${formatDay(option.entry.latest!.date)}</a>`
            : html`<a href=${option.href} tabindex="-1"><span class="label">${option.entry.label}</span>
                <span class="note">${option.entry.note || KIND_LABELS[option.entry.kind]}</span></a>`}
        </li>`)}
    </ul>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'site-search': SiteSearch;
  }
}
