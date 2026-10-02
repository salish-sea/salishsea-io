/**
 * The window a windowed ingest fetches when no curator names one: the ten days ending
 * today, UTC (decision 011). Shared by the Supabase function and the read-path build's own
 * Maplify ingest (decision 061), so both fetch the same days.
 */

import type { IngestWindow } from './persist.ts';

export function defaultWindow(now: Date = new Date()): IngestWindow {
    const end = now.toISOString().slice(0, 10);
    const startDate = new Date(now);
    startDate.setUTCDate(startDate.getUTCDate() - 10);
    return { start: startDate.toISOString().slice(0, 10), end };
}
