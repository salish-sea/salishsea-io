/**
 * The archive's hard floors (scripts/dwca/guard.ts): read from the environment when
 * asked, and refused when they would quietly weaken the check the read-path build
 * applies to the archive it writes (scripts/read-path/dwca.ts).
 *
 * The nightly's guard — file sizes on disk and a row count from Postgres — retired with
 * Postgres (salish-9uu.13); what it tested of the floors themselves is kept here.
 */

import { afterEach, describe, expect, test, vi } from 'vitest';

import { assertValidFloors, floorsFromEnv, type GuardFloors } from './guard.ts';

const FLOORS: GuardFloors = { zipBytes: 51_200, parquetBytes: 10_240, rows: 1_000n };

afterEach(() => { vi.unstubAllEnvs(); });

describe('floorsFromEnv', () => {
    test('reads the environment when called, with the G-02 defaults', () => {
        expect(floorsFromEnv({})).toEqual(FLOORS);
        expect(floorsFromEnv({ ZIP_FLOOR_BYTES: '1', PARQUET_FLOOR_BYTES: '2', ROW_FLOOR: '3' }))
            .toEqual({ zipBytes: 1, parquetBytes: 2, rows: 3n });

        // Reading process.env on each call is what makes the floors testable (salish-52s).
        vi.stubEnv('ROW_FLOOR', '4242');
        expect(floorsFromEnv().rows).toBe(4_242n);
    });

    test.each([
        ['a fractional value', '1.5'],
        ['a non-numeric value', 'lots'],
        ['a negative value', '-1'],
        ['an empty value', ''],
        ['zero', '0'],
        ['a padded zero', '  00  '],
        ['a plus-prefixed value', '+1'],
    ])('refuses a ROW_FLOOR that is %s', (_label, raw) => {
        // BigInt() throws on all but the empty case, so without screening these
        // escaped as an opaque SyntaxError instead of the guard's own message.
        expect(() => floorsFromEnv({ ROW_FLOOR: raw }))
            .toThrow(/guard floors are invalid: rows must be a positive integer/);
    });

    test.each([
        ['ZIP_FLOOR_BYTES', 'lots', /zipBytes must be a positive integer, got NaN/],
        // An unset variable referenced by a workflow arrives empty: Number('') is 0,
        // and a zero floor passes everything.
        ['ZIP_FLOOR_BYTES', '', /zipBytes must be a positive integer, got 0/],
        ['PARQUET_FLOOR_BYTES', '0', /parquetBytes must be a positive integer, got 0/],
    ])('refuses a %s of %j', (name, raw, message) => {
        expect(() => floorsFromEnv({ [name]: raw })).toThrow(message);
    });
});

describe('assertValidFloors', () => {
    test('passes the defaults', () => {
        expect(() => assertValidFloors(FLOORS)).not.toThrow();
    });

    test.each([
        ['zip floor of zero', { ...FLOORS, zipBytes: 0 }],
        ['parquet floor of zero', { ...FLOORS, parquetBytes: 0 }],
        ['row floor of zero', { ...FLOORS, rows: 0n }],
        ['negative floor', { ...FLOORS, zipBytes: -1 }],
        ['unparseable floor (NaN)', { ...FLOORS, zipBytes: Number.NaN }],
        // GuardFloors is erased at runtime, so a JavaScript caller can pass these.
        // `NaN < 1n` is false, so a bare range check would let them through.
        ['row floor passed as a number', { ...FLOORS, rows: 1_000 as unknown as bigint }],
        ['row floor of NaN', { ...FLOORS, rows: Number.NaN as unknown as bigint }],
    ])('refuses a %s', (_label, floors) => {
        expect(() => assertValidFloors(floors)).toThrow(/guard floors are invalid/);
    });

    test('a bad row-floor type is reported as a type problem, not a range one', () => {
        // A JS caller passing the wrong type needs to hear "bigint", an operator
        // with a bad env value needs to hear "integer".
        expect(() => assertValidFloors({ ...FLOORS, rows: 1_000 as unknown as bigint }))
            .toThrow('rows must be a bigint, got number');
    });
});
