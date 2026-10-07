/**
 * The site's search field (GH #640), in the nav on every page: one query field for every
 * named thing, as BeeAtlas's is (its ADR 0021). It finds what src/search.ts says, from
 * the index the read-path build writes (scripts/read-path/search-index.ts), fetched the
 * first time the search is opened, so a page that is never searched never loads it.
 *
 * A result is a link. An animal offers two: its page, and beneath it its most recent
 * sighting on the map (Peter, 2026-10-07); one never sighted offers only its page. The
 * list is an ARIA combobox: arrows move through every link, Enter follows the one
 * marked, Escape closes the search.
 *
 * In the nav it is an icon button, as BeeAtlas's search is (its bee-header.ts), and the
 * field opens in a popover beneath it: a field in the row would set its own baseline
 * against the nav's icons, and on a phone there is no room for one.
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

/** BeeAtlas's search glyph (heroicons' magnifying glass), at its header's 24px. */
const searchIcon = svg`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" width="24" height="24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-4.35-4.35m1.85-4.65a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"></path></svg>`;

@customElement('site-search')
export class SiteSearch extends LitElement {
  static styles = css`
    :host {
      align-items: center;
      display: flex;
      font: inherit;
      position: relative;
    }
    /* BeeAtlas's .icon-btn: a 44px target, dimmed until it is the thing in use. */
    .toggle {
      align-items: center;
      background: transparent;
      border: 0;
      border-bottom: 2px solid transparent;
      box-sizing: border-box;
      color: inherit;
      cursor: pointer;
      display: flex;
      justify-content: center;
      min-height: 44px;
      min-width: 44px;
      opacity: 0.6;
      padding: 10px;
    }
    .toggle:hover {
      opacity: 0.9;
    }
    .toggle[aria-expanded="true"] {
      border-bottom-color: var(--site-search-accent, #1976d2);
      opacity: 1;
    }
    .popover {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
      box-sizing: border-box;
      color: #213547;
      padding: 12px;
      /* Its left edge and width are set when it opens (place()), to stay on screen. */
      position: absolute;
      top: calc(100% + 4px);
      z-index: 1000;
    }
    input {
      background: white;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      box-sizing: border-box;
      color: #0f172a;
      font: inherit;
      font-size: 0.9375rem;
      padding: 8px 10px;
      width: 100%;
    }
    input:focus-visible {
      outline: 2px solid #1976d2;
      outline-offset: -1px;
    }
    ul {
      list-style: none;
      margin: 8px -12px -4px;
      max-height: min(60vh, 28rem);
      overflow-y: auto;
      padding: 0;
    }
    li a {
      color: #0f172a;
      display: block;
      padding: 0.4rem 12px;
      text-decoration: none;
    }
    li a.latest {
      color: #1565c0;
      font-size: 0.875rem;
      padding: 0.1rem 12px 0.45rem 28px;
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
      padding: 0.4rem 12px;
    }
  `;

  @state() private query = '';
  @state() private entries: SearchEntry[] | null = null;
  @state() private failed = false;
  @state() private active = -1;
  @state() private open = false;
  /** Where the popover sits, in px from the button's own left edge, and how wide. */
  @state() private placement = { left: 0, width: 384 };

  @query('input') private input?: HTMLInputElement;

  private get options(): Option[] {
    if (!this.entries) return [];
    return search(this.entries, this.query).flatMap(entry => [
      { entry, latest: false, href: entry.href },
      ...(entry.latest ? [{ entry, latest: true, href: entry.latest.href }] : []),
    ]);
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('click', this.onDocumentClick);
    window.addEventListener('resize', this.place);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('click', this.onDocumentClick);
    window.removeEventListener('resize', this.place);
  }

  /**
   * Hang the popover from the button's right edge, as BeeAtlas's hangs from its header's,
   * but never past the screen's left edge: on a phone the button isn't the last thing in
   * the row (the login button is), so right-aligned to it a full-width popover would run
   * off the left.
   */
  private place = () => {
    const margin = 8;
    const viewport = document.documentElement.clientWidth;
    const width = Math.min(384, viewport - 2 * margin);
    const button = this.getBoundingClientRect();
    const left = Math.max(margin, Math.min(button.right - width, viewport - margin - width));
    this.placement = { left: left - button.left, width };
  };

  /** A click anywhere outside the button and its popover closes it. */
  private onDocumentClick = (event: MouseEvent) => {
    if (this.open && !event.composedPath().includes(this)) this.open = false;
  };

  private async toggle() {
    this.open = !this.open;
    if (!this.open) return;
    this.place();
    // A search button that doesn't put the caret in the field costs a second tap.
    await this.updateComplete;
    this.input?.focus();
    if (this.entries) return;
    // A retry after a failure says it is loading again, not that it failed.
    this.failed = false;
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
  }

  private onKeydown(event: KeyboardEvent) {
    const options = this.options;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!options.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      this.active = (this.active + step + options.length) % options.length;
      // The list scrolls; the marked link must stay in it. Focus stays in the field.
      void this.updateComplete.then(() =>
        this.shadowRoot?.getElementById(`option-${this.active}`)?.scrollIntoView({ block: 'nearest' }));
    } else if (event.key === 'Enter') {
      const option = options[this.active] ?? options[0];
      if (option) {
        event.preventDefault();
        window.location.assign(option.href);
      }
    } else if (event.key === 'Escape') {
      this.open = false;
      this.shadowRoot?.querySelector<HTMLButtonElement>('.toggle')?.focus();
    }
  }

  protected render() {
    const options = this.options;
    const showList = this.query.trim() !== '';
    return html`
      <button class="toggle" type="button" aria-label="Search whales and places" title="Search"
        aria-haspopup="dialog" aria-expanded=${this.open ? 'true' : 'false'} @click=${this.toggle}>${searchIcon}</button>
      ${this.open ? html`
        <div class="popover" role="dialog" aria-label="Search"
          style=${`left: ${this.placement.left}px; width: ${this.placement.width}px`}>
          <input type="search" role="combobox" aria-label="Search whales and places" placeholder="Whale, matriline, or place"
            autocomplete="off" spellcheck="false" enterkeyhint="go" aria-autocomplete="list" aria-controls="results"
            aria-expanded=${showList ? 'true' : 'false'}
            aria-activedescendant=${showList && this.active >= 0 && options[this.active] ? `option-${this.active}` : nothing}
            .value=${this.query} @input=${this.onInput} @keydown=${this.onKeydown}>
          ${showList ? this.renderList(options) : nothing}
        </div>` : nothing}
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
            ? html`<a class="latest" href=${option.href} tabindex="-1"
                aria-label=${`${option.entry.label}'s latest sighting, ${formatDay(option.entry.latest!.date)}`}>Latest sighting · ${formatDay(option.entry.latest!.date)}</a>`
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
