/**
 * register.fold, the SQL twin of src/fold.ts (salish-8vr.18, migration 20260923040000).
 *
 * Sighting codes are matched against the catalogue in SQL and profile paths are resolved
 * in TypeScript, so the two must fold identically or a code would link in one place and
 * not the other. Asserted here against the register's published cases and against each
 * other, including the case the old normalize_designation() got wrong.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';
import { fold } from '../src/fold.ts';

const DSN = process.env['SUPABASE_DB_URL'];

// dist/fold_test.tsv as published; src/fold.test.ts holds the same list.
const PUBLISHED: readonly [string, string][] = [
    ['T090', 't90'], ['T090s', 't90s'], ['T065A5', 't65a5'], ['T65A5', 't65a5'],
    ['T000', 't0'], ['J-35', 'j35'], ['J35', 'j35'], ['J17s', 'j17s'],
    ["Bigg's", 'biggs'], ['Bigg’s', 'biggs'], ['Biggs', 'biggs'], ['SRKW', 'srkw'],
    ['  Southern   Resident ', 'southern resident'],
];

// Beyond the published cases: runs after the first, a zero inside a run, and the codes
// the old rule truncated (lpad('1242', 3) is '124', so T1242s read as the T124s).
const MORE = ['T002C10', 'T10', 'T100A', 'T1242s', 'T1241', 'CA20', 'AO10', 't-46bs', 'T 46Bs'];

describe.skipIf(!DSN)('register.fold (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN as string, {prepare: false, max: 1}); });
    afterAll(async () => { await sql.end(); });

    const sqlFold = async (name: string) =>
        (await sql<{ f: string }[]>`SELECT register.fold(${name}) AS f`)[0]!.f;

    test.each(PUBLISHED)('reproduces the published case %s', async (input, expected) => {
        expect(await sqlFold(input)).toBe(expected);
    });

    test.each(MORE)('agrees with src/fold.ts on %s', async (input) => {
        expect(await sqlFold(input)).toBe(fold(input));
    });

    test('does not truncate a four-digit run the way lpad did', async () => {
        expect(await sqlFold('T1242s')).not.toBe(await sqlFold('T124s'));
        expect(await sqlFold('T1241')).not.toBe(await sqlFold('T124'));
    });
});
