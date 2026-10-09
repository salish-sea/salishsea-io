/**
 * The window a windowed ingest fetches when no curator names one: the `days` days ending
 * today, UTC (decision 011). The read-path build's own ingests fetch it (decision 061).
 */

export type IngestWindow = {
    /** inclusive start date, 'YYYY-MM-DD' */
    readonly start: string;
    /** inclusive end date, 'YYYY-MM-DD' — the reconcile delete covers start .. end+1 day */
    readonly end: string;
};

export function defaultWindow(now: Date = new Date(), days = 10): IngestWindow {
    const end = now.toISOString().slice(0, 10);
    const startDate = new Date(now);
    startDate.setUTCDate(startDate.getUTCDate() - days);
    return { start: startDate.toISOString().slice(0, 10), end };
}
