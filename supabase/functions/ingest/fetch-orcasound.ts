/**
 * Orcasound fetch with retry — imperative shell (salish-8vr.26 / decision 011).
 *
 * Effectful: reads every page of orcasite's `/api/json/bouts`, parsing each with the pure
 * core as it goes, and returns the complete corpus or throws. The caller (index.ts) turns
 * any throw into a `failed` ingest.runs row and writes nothing.
 *
 * Completeness is what makes reconcile safe here, because there is no window (see
 * scripts/ingest/orcasound.ts): the corpus is complete only when the last page's `next`
 * link is null, and a corpus of zero bouts is refused outright — orcasite has held a few
 * hundred since 2025, so an empty answer is a fault, not a fact, and reconciling against
 * it would delete every bout we hold.
 */

import {
    MAX_ATTEMPTS,
    retryDelayMs,
    parseRetryAfter,
    isRetryableStatus,
    markTransientUpstream,
} from '../../../scripts/ingest/retry.ts';
import { parseBoutsPage, type NormalizedBout } from '../../../scripts/ingest/orcasound.ts';
import type { Logger } from './fetch-maplify.ts';

const ORIGIN = 'https://live.orcasound.net';
/**
 * Sparse fieldsets keep a page to what the core reads. Without them each feed carries its
 * intro HTML and each bout its stream relationships: 173 KB for the corpus with, several
 * times that without. `page[limit]` is orcasite's maximum.
 */
export const FIRST_PAGE_URL =
    `${ORIGIN}/api/json/bouts?page[limit]=250&include=feed,tags` +
    '&fields[bout]=name,category,start_time,end_time,feed_id' +
    '&fields[feed]=name,location_point' +
    '&fields[tag]=name,kind,iri';

/** More pages than the corpus could plausibly need at 250 a page: a runaway `next` link. */
const MAX_PAGES = 40;

const FETCH_TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function bodySnippet(text: string, max = 200): string {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    if (oneLine.length === 0) return '(empty body)';
    return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/** GET one URL as JSON with the shared retry policy. Same shape as fetchMaplify. */
async function fetchJson(url: string, log: Logger): Promise<unknown> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        let res: Response;
        try {
            res = await fetch(url, { headers: { accept: 'application/vnd.api+json' }, signal: controller.signal });
            if (res.ok) {
                const text = await res.text();
                clearTimeout(timeout);
                try {
                    return JSON.parse(text) as unknown;
                } catch {
                    throw new Error(
                        `orcasite returned a non-JSON ${res.status} body (${text.length} chars): ${bodySnippet(text)}`,
                    );
                }
            }
        } catch (e) {
            clearTimeout(timeout);
            lastError = markTransientUpstream(e);
            if (attempt === MAX_ATTEMPTS) break;
            const delay = retryDelayMs(attempt);
            log('orcasound fetch error, retrying', { attempt, delayMs: delay, error: String(e) });
            await sleep(delay);
            continue;
        }

        clearTimeout(timeout);
        const httpError = new Error(`orcasite HTTP ${res.status}`);
        lastError = isRetryableStatus(res.status) ? markTransientUpstream(httpError) : httpError;
        await res.body?.cancel();
        if (!isRetryableStatus(res.status) || attempt === MAX_ATTEMPTS) break;
        const delay = retryDelayMs(attempt, parseRetryAfter(res.headers.get('retry-after')));
        log('orcasound non-2xx, retrying', { attempt, status: res.status, delayMs: delay });
        await sleep(delay);
    }

    throw lastError ?? new Error('orcasound fetch failed');
}

export type BoutsCorpus = {
    /** Every bout upstream holds, all categories, in page order. */
    readonly bouts: readonly NormalizedBout[];
    readonly pages: number;
};

/**
 * The whole corpus, or a throw. Follows `links.next` until it is null, refusing to leave
 * orcasite's origin and refusing more than MAX_PAGES.
 */
export async function fetchAllBouts(log: Logger, firstUrl = FIRST_PAGE_URL): Promise<BoutsCorpus> {
    const bouts: NormalizedBout[] = [];
    let url: string | null = firstUrl;
    let pages = 0;

    while (url !== null) {
        if (!url.startsWith(`${ORIGIN}/`)) throw new Error(`orcasite next link left its origin: ${url}`);
        if (pages >= MAX_PAGES) throw new Error(`orcasite pagination exceeded ${MAX_PAGES} pages`);
        const raw = await fetchJson(url, log);
        const result = parseBoutsPage(raw);
        if (!result.ok) throw new Error(`orcasound parse failed on page ${pages + 1}: ${result.error}`);
        pages++;
        bouts.push(...result.bouts);
        log('orcasound page', { page: pages, bouts: result.bouts.length, next: result.next !== null });
        url = result.next;
    }

    if (bouts.length === 0) {
        throw new Error('orcasite returned no bouts; refusing to reconcile against an empty corpus');
    }
    return { bouts, pages };
}
