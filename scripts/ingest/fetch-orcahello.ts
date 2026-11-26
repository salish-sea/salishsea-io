/**
 * OrcaHello's detections for one UTC day — imperative shell (salish-fizm.1).
 *
 * Effectful: reads the pages of `/api/detections` for one day, handing each parsed page
 * to `onPage` as it arrives, and returns how many detections the day has and how many came
 * back. Its caller is scripts/read-path/ingest-orcahello.ts, which upserts each page.
 *
 * OrcaHello's API is fragile: every page reloads and sorts the whole query's rows in
 * memory, and it fell over on 2026-11-24 under a query for all time. So this asks for one
 * day, a page of 50 at a time, waits between pages, and never retries inside a run: on a
 * 5xx, a 403 ("Site Disabled", what it answers when overloaded), a 429 or a timeout it
 * stops, and the next run is the retry. The failure is marked transient (decision 042),
 * since waiting is the fix. Pages already handed to `onPage` stay handed over.
 *
 * There is no way to name a time zone in DateFrom and DateTo, and a day's range
 * [day, day + 1) came back as exactly that UTC day on 2026-11-26; the schedule overlaps its
 * days anyway, and the mirror only upserts.
 */

import { addDays } from '../read-path/windows.ts';
import type { Logger } from './fetch-json.ts';
import { parseOrcaHelloPage, type OrcaHelloRow } from './orcahello.ts';
import { markTransientUpstream } from './retry.ts';

const ORIGIN = 'https://aifororcasdetections.azurewebsites.net';
export const RECORDS_PER_PAGE = 50;
/** A day has had about a thousand detections at most; this is a runaway total's bound. */
const MAX_PAGES = 200;
/** Between pages, so the API is never asked faster than this. */
export const PAUSE_MS = 2_000;
const TIMEOUT_MS = 60_000;

/** The URL of one page of one UTC day's detections. */
export function pageUrl(day: string, page: number): string {
    const q = new URLSearchParams({
        Page: String(page), RecordsPerPage: String(RECORDS_PER_PAGE), Timeframe: 'range',
        DateFrom: day, DateTo: addDays(day, 1), SortBy: 'timestamp', SortOrder: 'asc', Location: 'all',
    });
    return `${ORIGIN}/api/detections?${q}`;
}

/** One page: its body and the total the API says the query holds. One attempt. */
export type PageFetcher = (url: string) => Promise<{body: unknown, total: number | null}>;

export const fetchPage: PageFetcher = async (url) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    let text: string;
    try {
        res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'salishsea-io-read-path' }, signal: controller.signal });
        // the body under the same timeout, which clears once it is read
        text = res.ok && res.status !== 204 ? await res.text() : '';
    } catch (error) {
        // an abort, a refused connection or a stalled body: transient, like the fetch layer's
        throw markTransientUpstream(error);
    } finally {
        clearTimeout(timeout);
    }
    if (res.status === 204) return { body: [], total: 0 };
    if (!res.ok) {
        await res.body?.cancel();
        const error = new Error(`OrcaHello HTTP ${res.status}`);
        // what an overloaded API answers, or a refusal that waiting ends: not ours to fix
        throw res.status === 403 || res.status === 429 || res.status >= 500 ? markTransientUpstream(error) : error;
    }
    if (text.trim() === '') return { body: [], total: 0 };
    try {
        const said = res.headers.get('totalNumberRecords');
        const total = said === null ? NaN : Number(said);
        return { body: JSON.parse(text) as unknown, total: Number.isFinite(total) ? total : null };
    } catch {
        throw markTransientUpstream(new Error(`OrcaHello returned a non-JSON ${res.status} body (${text.length} chars)`));
    }
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Every page of `day`, each handed to `onPage` when it arrives. Stops at a short page or
 * once the total is reached. `total` is what the API said the day holds; `fetched` is how
 * many distinct detections came back, so the caller records the day as fully read only
 * when the two agree. Throws on any failure, after the pages before it were handed over.
 */
export async function fetchOrcaHelloDay(
    day: string, log: Logger, onPage: (rows: readonly OrcaHelloRow[]) => void,
    {pauseMs = PAUSE_MS, getPage = fetchPage}: {pauseMs?: number, getPage?: PageFetcher} = {},
): Promise<{total: number, fetched: number}> {
    const ids = new Set<string>();
    let total: number | null = null;
    for (let page = 1; page <= MAX_PAGES; page++) {
        const {body, total: said} = await getPage(pageUrl(day, page));
        const result = parseOrcaHelloPage(body);
        if (!result.ok) throw new Error(`orcahello parse failed on page ${page} of ${day}: ${result.error}`);
        total ??= said;
        for (const row of result.rows) ids.add(row.id);
        onPage(result.rows);
        log('orcahello page', { day, page, detections: result.rows.length });
        if (result.rows.length < RECORDS_PER_PAGE || (total !== null && ids.size >= total)) break;
        await sleep(pauseMs);
    }
    return { total: total ?? ids.size, fetched: ids.size };
}
