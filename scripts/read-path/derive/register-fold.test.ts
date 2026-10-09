import { describe, expect, test } from 'vitest';

import { fold } from '../../../src/fold.ts';
import { withMacros } from './sql-macros.ts';

/**
 * register.fold's twin in derive/identifier-candidates.sql, which spells Postgres's
 * lookbehind (?<!\d)0+(?=\d) without one, against what the function answered and against
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

/** What register.fold answered for the corpus, captured before Postgres retired (salish-9uu.11). */
const POSTGRES: [string, string][] = [
    ["T065A", "t65a"],
    ["T65A", "t65a"],
    ["T0", "t0"],
    ["T00", "t0"],
    ["T000", "t0"],
    ["T090", "t90"],
    ["T002C10", "t2c10"],
    ["T0102", "t102"],
    ["CRC-0018676", "crc18676"],
    ["J027s", "j27s"],
    ["L087", "l87"],
    ["Bigg's", "biggs"],
    ["Bigg’s", "biggs"],
    ["  T 065   A  ", "t 65 a"],
    ["T-065-A", "t65a"],
    ["K0", "k0"],
    ["0", "0"],
    ["007", "7"],
    ["a01b02", "a1b2"],
    ["x0y03", "x0y3"],
    ["T65As", "t65as"],
    ["J27S", "j27s"],
    ["Southern Resident", "southern resident"],
    ["T137A, T137B", "t137a, t137b"],
    ["10", "10"],
    ["100", "100"],
    ["1001", "1001"],
];

describe('register_fold answers what register.fold did', () => {
    test('on the corpus', async () => {
        expect(POSTGRES.map(([name]) => name)).toEqual(CORPUS);
        const query = await withMacros('identifier-candidates.sql');
        for (const [name, folded] of POSTGRES)
            expect(await query(`SELECT register_fold($name)`, {name}), name).toBe(folded);
    });
});
