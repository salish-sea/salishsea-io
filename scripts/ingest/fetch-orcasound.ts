/**
 * Orcasound fetch with retry — imperative shell (salish-8vr.26 / decision 011).
 *
 * Effectful: reads every page of orcasite's `/api/json/bouts`, parsing each with the pure
 * core as it goes, and returns the complete corpus or throws. Its caller is the read-path
 * build's ingest (scripts/read-path/ingest-orcasound.ts, decision 061), which writes
 * nothing on a throw; until 2026-10-05 the Supabase `ingest` function called it too.
 *
 * Completeness is what makes reconcile safe here, because there is no window (see
 * scripts/ingest/orcasound.ts): the corpus is complete only when the last page's `next`
 * link is null, and a corpus of zero bouts is refused outright — orcasite has held a few
 * hundred since 2025, so an empty answer is a fault, not a fact, and reconciling against
 * it would delete every bout we hold.
 */

import { fetchJsonWithRetry, type Logger } from './fetch-json.ts';
import { parseBoutsPage, type NormalizedBout } from './orcasound.ts';

const ORIGIN = 'https://live.orcasound.net';
/**
 * Sparse fieldsets keep a page to what the core reads. Without them each feed carries its
 * intro HTML and each bout its stream relationships: 357 KB for the corpus with, several
 * times that without. `page[limit]` is orcasite's maximum.
 *
 * Tags come through their applications (`item_tags.tag`), which is where certainty lives
 * (decision 054). `fields[item_tag]` must not name `tag`: orcasite then embeds the whole
 * tag as an attribute of the application instead of relating it.
 */
export const FIRST_PAGE_URL =
    `${ORIGIN}/api/json/bouts?page[limit]=250&include=feed,item_tags.tag` +
    '&fields[bout]=name,category,start_time,end_time,feed_id' +
    '&fields[feed]=name,location_point' +
    '&fields[tag]=name,kind,iri' +
    '&fields[item_tag]=certainty';

/** More pages than the corpus could plausibly need at 250 a page: a runaway `next` link. */
const MAX_PAGES = 40;

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
        const raw = await fetchJsonWithRetry(url, { name: 'orcasite', accept: 'application/vnd.api+json' }, log);
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
