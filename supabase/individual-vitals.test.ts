/**
 * public.refresh_individual_vitals: an animal's sex, birth years and life status are the
 * register's (decision 051, salish-ox2.8, migration 20260924010000).
 *
 * Seeded rather than read from a loaded edition, so it runs in CI where `register.*` is
 * empty. Everything happens inside a transaction that is rolled back, which is also why
 * the "register not loaded" case can empty register.current_status without harm.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';

const DSN = process.env['SUPABASE_DB_URL'];

class Rollback extends Error {}

type Vitals = { sex: string | null; born_earliest: number | null; born_latest: number | null; life_status: string };

// One animal per shape the register publishes, plus one it does not hold.
const ANIMALS: [string, string, string, string | null][] = [
    // entity,       born,      sex, status
    ['SSA:9711001', '1998',    'F', 'alive'],
    ['SSA:9711002', '../1961', 'M', 'dead'],
    ['SSA:9711003', '2020-09', 'U', 'presumed_dead'],
    ['SSA:9711004', '',        '',  null],          // the register says nothing
    ['SSA:9711005', '1979~',   'F', 'unknown'],     // a shape we do not read
];

describe.skipIf(!DSN)('refresh_individual_vitals (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN as string, {prepare: false, max: 1}); });
    afterAll(async () => { await sql.end(); });

    const run = async (opts: { statusLoaded: boolean }) => {
        let result: Record<string, Vitals> = {};
        let changed = -1;
        let secondRun = -1;
        await sql.begin(async tx => {
            for (const [id, born, sex] of ANIMALS)
                await tx`INSERT INTO register.entities (entity_id, kind, label, born, sex)
                         VALUES (${id}, 'individual', ${id}, ${born}, ${sex})`;
            // Stands in for everything the loader has put there; rolled back below.
            await tx`DELETE FROM register.current_status`;
            if (opts.statusLoaded)
                for (const [id, , , status] of ANIMALS)
                    if (status) await tx`INSERT INTO register.current_status (entity_id, status) VALUES (${id}, ${status})`;
            // Where a real edition is loaded, emptying current_status above changes every
            // real animal too; settle them first so the count below is only ours.
            await tx`SELECT public.refresh_individual_vitals()`;
            // What our seed used to write, so every column has something to overwrite.
            for (const [id] of ANIMALS)
                await tx`INSERT INTO public.individuals (primary_designation, entity_id, sex, born_earliest, born_latest, life_status)
                         VALUES (${id}, ${id}, 'female', 1900, 1900, 'alive')`;
            await tx`INSERT INTO public.individuals (primary_designation, sex, born_earliest, born_latest, life_status)
                     VALUES ('NOT-IN-REGISTER', 'male', 1950, 1950, 'deceased')`;
            [{ changed }] = await tx<{ changed: number }[]>`SELECT public.refresh_individual_vitals() AS changed`;
            const [{ again }] = await tx<{ again: number }[]>`SELECT public.refresh_individual_vitals() AS again`;
            secondRun = again;
            const rows = await tx<(Vitals & { primary_designation: string })[]>`
                SELECT primary_designation, sex::text, born_earliest, born_latest, life_status::text
                FROM public.individuals
                WHERE primary_designation LIKE 'SSA:9711%' OR primary_designation = 'NOT-IN-REGISTER'`;
            result = Object.fromEntries(rows.map(({ primary_designation, ...v }) => [primary_designation, v]));
            throw new Rollback();
        }).catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
        return { result, changed, secondRun };
    };

    test('maps each of the register\'s encodings onto ours', async () => {
        const { result } = await run({ statusLoaded: true });
        expect(result['SSA:9711001']).toEqual({ sex: 'female', born_earliest: 1998, born_latest: 1998, life_status: 'alive' });
        expect(result['SSA:9711002']).toEqual({ sex: 'male', born_earliest: null, born_latest: 1961, life_status: 'deceased' });
        expect(result['SSA:9711003']).toEqual({ sex: null, born_earliest: 2020, born_latest: 2020, life_status: 'presumed_deceased' });
    });

    test('an animal the register says nothing about has no sex, birth or status of ours left over', async () => {
        const { result } = await run({ statusLoaded: true });
        expect(result['SSA:9711004']).toEqual({ sex: null, born_earliest: null, born_latest: null, life_status: 'unknown' });
    });

    test('a birth shape it does not read becomes not known, rather than a guess', async () => {
        const { result } = await run({ statusLoaded: true });
        expect(result['SSA:9711005']).toMatchObject({ born_earliest: null, born_latest: null });
    });

    test('never blanks: an animal the register does not hold keeps what it has', async () => {
        const { result } = await run({ statusLoaded: true });
        expect(result['NOT-IN-REGISTER']).toEqual({ sex: 'male', born_earliest: 1950, born_latest: 1950, life_status: 'deceased' });
    });

    test('never blanks: life status is left alone while no status has been loaded', async () => {
        const { result } = await run({ statusLoaded: false });
        expect(result['SSA:9711004']!.life_status).toBe('alive');
        expect(result['SSA:9711001']!.sex).toBe('female');   // the other columns still copy
    });

    test('reports how many animals it changed, and a second run changes none', async () => {
        const { changed, secondRun } = await run({ statusLoaded: true });
        expect(changed).toBe(ANIMALS.length);
        expect(secondRun).toBe(0);
    });
});
