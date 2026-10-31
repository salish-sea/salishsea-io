/**
 * The build's own reading: the two macros in derive/extract.sql, run over the full
 * comment as the build runs them. They answer codes and a direction only; the other
 * fields are empty, which the scorer counts as wrong wherever the gold row has any.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { readFileSync } from 'node:fs';
import type { GoldRow } from '../gold.ts';
import type { Reading } from '../score.ts';

export async function readWithRegex(rows: GoldRow[]): Promise<Map<number, Reading>> {
    const conn = await (await DuckDBInstance.create(':memory:')).connect();
    await conn.run(readFileSync(new URL('../../read-path/derive/extract.sql', import.meta.url), 'utf8'));
    await conn.run('CREATE TABLE corpus (n INTEGER, body VARCHAR)');
    const appender = await conn.createAppender('corpus');
    for (const r of rows) { appender.appendInteger(r.row); appender.appendVarchar(r.comment); appender.endRow(); }
    appender.flushSync(); appender.closeSync();
    const got = (await conn.runAndReadAll(
        'SELECT n, extract_travel_direction(body) AS direction, extract_identifiers(body) AS identifiers FROM corpus ORDER BY n',
    )).getRowObjectsJS() as unknown as {n: number, direction: string | null, identifiers: {items: string[]} | string[] | null}[];
    return new Map(got.map(r => [r.n, {
        codes_present: r.identifiers === null ? [] : Array.isArray(r.identifiers) ? r.identifiers : r.identifiers.items,
        codes_absent: [], codes_hedged: [], pods: [],
        direction: r.direction,
    }]));
}
