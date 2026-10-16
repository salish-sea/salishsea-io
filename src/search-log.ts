/**
 * What the search field tells the write API about each search (decision 078): one record
 * when someone chooses a result, or when they give up, by closing the field or pausing
 * for a few seconds without choosing. Misses are the point as much as hits: a search that
 * found nothing, or found something nobody chose, says what is missing.
 *
 * Nothing that identifies a person is sent: the words, how many results they found, what
 * was chosen, and the kind of page the field was on. A failure is ignored; search works
 * the same whether or not it is recorded.
 */

/** One search, as api/searches.ts takes it. */
export interface SearchRecord {
  query: string;
  results: number;
  chosen_kind: string | null;
  chosen_label: string | null;
  page: string;
}

/** How long a pause, in milliseconds, counts as giving up. */
export const GIVE_UP_AFTER = 3000;

/** The kind of page the field is on: the path's first part ("individuals"), or "map" for the map. */
export function pageKind(pathname: string): string {
  return pathname.split('/').filter(Boolean)[0]?.replace(/\.html$/, '') ?? 'map';
}

/** Send a record to the write API; keepalive, so a choice that leaves the page still arrives. */
export function sendSearch(record: SearchRecord): void {
  void fetch('/api/searches', {
    method: 'POST', keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(record),
  }).catch(() => {});
}

/**
 * Turns what the field sees, a query at a time, into records. A query is recorded once:
 * pausing on "lime" and then closing the field sends one record, not two.
 */
export class SearchRecorder {
  private pending: { query: string; results: number } | null = null;
  private last: string | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  private readonly page: string;
  private readonly send: (record: SearchRecord) => void;
  private readonly wait: number;

  constructor(page: string, send: (record: SearchRecord) => void = sendSearch, wait = GIVE_UP_AFTER) {
    this.page = page;
    this.send = send;
    this.wait = wait;
  }

  /** The field now holds this query, which finds this many results. */
  typed(query: string, results: number): void {
    clearTimeout(this.timer);
    const q = query.trim();
    this.pending = q ? { query: q, results } : null;
    if (this.pending) this.timer = setTimeout(() => this.gaveUp(), this.wait);
  }

  /** The results for the query changed without typing, as when places arrive. */
  found(results: number): void {
    if (this.pending) this.pending.results = results;
  }

  /** Someone chose a result. */
  chose(query: string, results: number, kind: string, label: string): void {
    clearTimeout(this.timer);
    this.pending = null;
    const q = query.trim();
    if (!q) return;
    this.last = q;
    this.send({ query: q, results, chosen_kind: kind, chosen_label: label, page: this.page });
  }

  /** The field closed, or the page is going away: a query left in it was given up. */
  gaveUp(): void {
    clearTimeout(this.timer);
    const p = this.pending;
    this.pending = null;
    if (!p || p.query === this.last) return;
    this.last = p.query;
    this.send({ query: p.query, results: p.results, chosen_kind: null, chosen_label: null, page: this.page });
  }
}
