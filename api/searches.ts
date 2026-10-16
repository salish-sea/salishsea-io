/**
 * What people search for (decision 078): the search field (src/site-search.ts, by way of
 * src/search-log.ts) sends one record when someone chooses a result or gives up. Anyone
 * may write, as with feedback (039), and nobody reads it back through the API; it is read
 * with SQL on the store. Nothing that identifies a person is kept, not even the sender's
 * address, which only the rate limit sees, in memory.
 */

import type { DatabaseSync } from 'node:sqlite';

import { isoMicros, Refused } from './sightings.ts';

export type SearchInput = {query: string, results: number, chosen_kind: string | null, chosen_label: string | null,
    page: string | null};

const optional = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

export function parseSearch(body: Record<string, unknown>): SearchInput {
    const query = optional(body['query']);
    const results = body['results'];
    if (!query || typeof results !== 'number' || !Number.isInteger(results) || results < 0)
        throw new Refused(400, 'a search needs its query and how many results it found');
    const chosen_kind = optional(body['chosen_kind']);
    const chosen_label = optional(body['chosen_label']);
    if ((chosen_kind === null) !== (chosen_label === null)) throw new Refused(400, 'a choice needs its kind and its label');
    return {query, results, chosen_kind, chosen_label, page: optional(body['page'])};
}

export function recordSearch(store: DatabaseSync, input: SearchInput, now = new Date()): void {
    try {
        store.prepare(`INSERT INTO searches (created_at, query, results, chosen_kind, chosen_label, page)
            VALUES (?, ?, ?, ?, ?, ?)`)
            .run(isoMicros(now), input.query, input.results, input.chosen_kind, input.chosen_label, input.page);
    } catch (error) {
        if (error instanceof Error && /CHECK constraint failed/.test(error.message))
            throw new Refused(400, 'a field is too long');
        throw error;
    }
}
