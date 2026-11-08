/**
 * Maplify fetch with retry — imperative shell (salishsea-io-89d.1 / decision 011).
 *
 * Builds the request and fetches it with the ingest's retry policy (fetch-json.ts).
 * Returns the parsed JSON body, or throws; its caller, the read-path build's ingest
 * (scripts/read-path/ingest-maplify.ts, decision 061), writes nothing on a throw.
 * Maplify serves a 200 with a non-JSON body on its own server-side failures, which the
 * error then quotes.
 */

import { fetchJsonWithRetry, type Logger } from './fetch-json.ts';
import type { IngestWindow } from './window.ts';
import { acartiaExtent } from '../../src/extents.ts';

// The fetch reaches the whole Southern Resident range (Acartia's boundaries),
// not just the Salish Sea: killer whales are consumed range-wide, everything
// else is kept only inside the Salish Sea by isIngestable (decision 036).
const BBOX = acartiaExtent.join(',');
const MAPLIFY_URL = 'https://maplify.com/waseak/php/search-all-sightings.php';

export async function fetchMaplify(window: IngestWindow, log: Logger): Promise<unknown> {
    const url = `${MAPLIFY_URL}?start=${window.start}&end=${window.end}&BBOX=${BBOX}`;
    return fetchJsonWithRetry(url, { name: 'Maplify' }, log);
}
