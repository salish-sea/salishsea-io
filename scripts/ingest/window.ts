/**
 * The window a windowed ingest fetches when no curator names one: the `days` days ending
 * today, UTC (decision 011). Shared by the Supabase function, which fetches ten, and the
 * read-path build's own Maplify ingest (decision 061), which fetches thirty.
 */

import type { IngestWindow } from './persist.ts';

export function defaultWindow(now: Date = new Date(), days = 10): IngestWindow {
    const end = now.toISOString().slice(0, 10);
    const startDate = new Date(now);
    startDate.setUTCDate(startDate.getUTCDate() - days);
    return { start: startDate.toISOString().slice(0, 10), end };
}
