/**
 * Orcasound's detections for one window, with retry — imperative shell (salish-fizm.1).
 *
 * Effectful: reads every page of orcasite's `/api/json/detections` for the window's days,
 * parsing each with the pure core (orcasound-detections.ts) as it goes, and returns the
 * window's complete answer or throws. Its caller is the read-path build's ingest
 * (scripts/read-path/ingest-orcasound-detections.ts), which writes nothing on a throw.
 *
 * Completeness is what makes reconcile safe: the fetch asks orcasite to count what
 * matches (`page[count]=true`) and returns only when the distinct detections it holds are
 * exactly that many. Offset paging over a table that grows can repeat a row and skip
 * another, which a bare "the last page's `next` is null" would not notice; the count does.
 * A window that comes back short or long is refused, and the next run asks again.
 */

import { fetchJsonWithRetry, type Logger } from './fetch-json.ts';
import { parseDetectionsPage, type NormalizedDetection, type NormalizedFeed } from './orcasound-detections.ts';
import { addDays } from '../read-path/windows.ts';
import type { IngestWindow } from './window.ts';

const ORIGIN = 'https://live.orcasound.net';

/** More pages than a window could plausibly need at 250 a page: a runaway `next` link. */
const MAX_PAGES = 100;

/**
 * Sparse fieldsets keep a page to what the core reads, and leave out `description` and
 * `source_ip`. Sorted by time and then id, so the offsets are stable between pages.
 * `page[limit]` is orcasite's maximum. The window is whole UTC days, `end` included, unless it
 * ends at `until`, an instant before then.
 */
export function windowUrl(window: DetectionsWindowBounds): string {
    return `${ORIGIN}/api/json/detections?page[limit]=250&page[count]=true&sort=timestamp,id` +
        `&filter[timestamp][greater_than_or_equal]=${window.start}T00:00:00Z` +
        `&filter[timestamp][less_than]=${windowEnd(window)}` +
        '&include=feed' +
        '&fields[detection]=timestamp,source,category,listener_count,visible,idempotency_key,feed_id,candidate_id' +
        '&fields[feed]=name,location_point';
}

/**
 * A window that may stop short of its last day. The scheduled window ends a quarter of an
 * hour before the run (cutoff): a detection arriving while the window is paged would change
 * orcasite's count and fail the run (on 2026-11-27, 5 runs of 493 failed so), and nothing
 * arrives with a time that far back. The next run's window covers what this one stopped short of.
 */
export type DetectionsWindowBounds = IngestWindow & {
    /** An exclusive end before `end`'s next midnight, as cutoff writes it; none means that midnight. */
    readonly until?: string;
};

/**
 * The window's exclusive end, as text that compares against the mirror's timestamps as times
 * do: orcasite writes them with six decimals and a Z, and so does this.
 */
export function windowEnd(window: DetectionsWindowBounds): string {
    return window.until ?? `${addDays(window.end, 1)}T00:00:00.000000Z`;
}

/** `minutes` before `now`, to the minute, in orcasite's form: the scheduled window's `until`. */
export function cutoff(now: Date, minutes = 15): string {
    const at = new Date(now.getTime() - minutes * 60_000);
    at.setUTCSeconds(0, 0);
    return at.toISOString().replace(/\.\d{3}Z$/, '.000000Z');
}

export type DetectionsWindow = {
    /** Every detection in the window, once each, in page order. */
    readonly detections: readonly NormalizedDetection[];
    readonly feeds: readonly NormalizedFeed[];
    readonly pages: number;
};

/**
 * The window's detections, or a throw. Follows `links.next` until it is null, refusing to
 * leave orcasite's origin and refusing more than MAX_PAGES, and refuses an answer whose
 * distinct detections are not the count orcasite gave.
 */
export async function fetchDetectionsWindow(window: DetectionsWindowBounds, log: Logger): Promise<DetectionsWindow> {
    const byId = new Map<string, NormalizedDetection>();
    const feeds = new Map<string, NormalizedFeed>();
    let total: number | null = null;
    let url: string | null = windowUrl(window);
    let pages = 0;

    while (url !== null) {
        if (!url.startsWith(`${ORIGIN}/`)) throw new Error(`orcasite next link left its origin: ${url}`);
        if (pages >= MAX_PAGES) throw new Error(`orcasite pagination exceeded ${MAX_PAGES} pages`);
        const raw = await fetchJsonWithRetry(url, { name: 'orcasite', accept: 'application/vnd.api+json' }, log);
        const result = parseDetectionsPage(raw);
        if (!result.ok) throw new Error(`orcasound detections parse failed on page ${pages + 1}: ${result.error}`);
        pages++;
        // The count comes with every page; the first one's is the one the offsets were laid out by,
        // so a count that moves while paging means rows came or went between pages: the window
        // is not one answer, and nothing is written for it.
        if (result.total !== null && total !== null && result.total !== total)
            throw new Error(`orcasite's count for ${window.start}..${window.end} changed from ${total} to ${result.total} while paging; nothing written`);
        total ??= result.total;
        for (const d of result.detections) byId.set(d.id, d);
        for (const f of result.feeds) feeds.set(f.id, f);
        log('orcasound detections page', { page: pages, detections: result.detections.length, next: result.next !== null });
        url = result.next;
    }

    if (total === null) throw new Error('orcasite did not say how many detections match; refusing to reconcile a window it did not count');
    if (byId.size !== total)
        throw new Error(`orcasite counted ${total} detections for ${window.start}..${window.end} but ${byId.size} came back; nothing written`);
    return { detections: [...byId.values()], feeds: [...feeds.values()], pages };
}
