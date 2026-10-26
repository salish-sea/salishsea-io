import { describe, expect, test } from 'vitest';

import { registerFile } from './register-file.ts';

describe('registerFile (salish-vedj)', () => {
    // Stelis's salishsea.rkt places the register by the same rule, and its salishsea-test.rkt
    // holds it there: the graph must observe the file these scripts read.
    test('mirrors/register.duckdb beside the snapshot', () => {
        expect(registerFile('/data/read-path.duckdb')).toBe('/data/mirrors/register.duckdb');
        expect(registerFile('data/read-path.duckdb')).toBe('data/mirrors/register.duckdb');
    });
});
