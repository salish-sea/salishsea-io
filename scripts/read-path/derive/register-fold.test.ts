import postgres from 'postgres';
import { describe, expect, test } from 'vitest';

import { fold } from '../../../src/fold.ts';
import { withMacros } from './sql-macros.ts';

/**
 * register.fold's twin in derive/identifier-candidates.sql, which spells Postgres's
 * lookbehind (?<!\d)0+(?=\d) without one, against the function itself and against
 * src/fold.ts, the rule's TypeScript home. Designation-shaped strings: leading zeros
 * inside and between runs, all-zero runs, apostrophes, hyphens, spacing, case.
 */
const CORPUS = [
    'T065A', 'T65A', 'T0', 'T00', 'T000', 'T090', 'T002C10', 'T0102', 'CRC-0018676', 'J027s', 'L087',
    "Bigg's", 'Bigg’s', '  T 065   A  ', 'T-065-A', 'K0', '0', '007', 'a01b02', 'x0y03', 'T65As', 'J27S',
    'Southern Resident', 'T137A, T137B', '10', '100', '1001',
];

describe('register_fold', () => {
    test('agrees with src/fold.ts on the corpus', async () => {
        const query = await withMacros('identifier-candidates.sql');
        for (const name of CORPUS)
            expect(await query(`SELECT register_fold($name)`, {name}), name).toBe(fold(name));
    });
});

const DSN = process.env['SUPABASE_DB_URL'];

describe.skipIf(!DSN)('register_fold agrees with register.fold (local Supabase)', () => {
    test('on the corpus', async () => {
        const query = await withMacros('identifier-candidates.sql');
        const sql = postgres(DSN as string, {prepare: false, max: 1});
        try {
            const rows = await sql<{name: string, folded: string}[]>`
                SELECT name, register.fold(name) AS folded FROM unnest(${CORPUS}::text[]) AS c(name)`;
            for (const {name, folded} of rows)
                expect(await query(`SELECT register_fold($name)`, {name}), name).toBe(folded);
        } finally {
            await sql.end();
        }
    });
});
