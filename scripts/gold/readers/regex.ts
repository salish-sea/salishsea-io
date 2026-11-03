/**
 * The build's reading until decision 105: the two macros in regex.sql, run over the full
 * comment as the build ran them, kept so a reader can still be measured against them. They answer codes and a direction only; the other
 * fields are empty and every code is a certain presence, which the scorer counts as wrong
 * wherever the gold row says otherwise.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { readFileSync } from 'node:fs';
import type { GoldRow } from '../gold.ts';
import type { Reading } from '../score.ts';

export async function readWithRegex(rows: GoldRow[]): Promise<Map<number, Reading>> {
    const conn = await (await DuckDBInstance.create(':memory:')).connect();
    await conn.run(readFileSync(new URL('./regex.sql', import.meta.url), 'utf8'));
    await conn.run('CREATE TABLE corpus (n INTEGER, body VARCHAR)');
    const appender = await conn.createAppender('corpus');
    for (const r of rows) { appender.appendInteger(r.row); appender.appendVarchar(r.comment); appender.endRow(); }
    appender.flushSync(); appender.closeSync();
    const got = (await conn.runAndReadAll(
        'SELECT n, extract_travel_direction(body) AS direction, extract_identifiers(body) AS identifiers FROM corpus ORDER BY n',
    )).getRowObjectsJS() as unknown as {n: number, direction: string | null, identifiers: {items: string[]} | string[] | null}[];
    return new Map(got.map(r => [r.n, {
        claims: (r.identifiers === null ? [] : Array.isArray(r.identifiers) ? r.identifiers : r.identifiers.items)
            .map(code => ({code, presence: 'present' as const, certainty: 'certain' as const})),
        pods: [],
        direction: r.direction,
    }]));
}
