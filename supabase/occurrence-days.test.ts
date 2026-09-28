/**
 * occurrence_days counts every sighting the moment it is saved (decision 055).
 *
 * It reads derived.occurrences, which each writer keeps current in its own transaction.
 * Until 055 it split its range at 48 hours ago, older days coming from a matview that lagged
 * by up to five minutes (bd salish-xfo); the store does not lag, so the split went. These
 * tests pin what a visitor relies on:
 *
 * - anon must still be able to call it, though derived.* is closed to anon (the function is
 *   SECURITY DEFINER for that reason);
 * - a sighting saved just now counts, however long ago it was observed (decision 021);
 * - one outside the bbox does not.
 *
 * Each test runs in a rolled-back transaction; gated on SUPABASE_DB_URL like the other
 * integration tiers (decision 011).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import type { Sql, TransactionSql } from 'postgres';

const DSN = process.env['SUPABASE_DB_URL'];

/** Ids in the band persist.test.ts reserves for test rows; the rollback removes them anyway. */
const RECENT = 900811;
const OLDER = 900812;

const ROLLBACK = Symbol('rollback');

/** Run `body` in a transaction that is always rolled back; return what it produced. */
async function rolledBack<T>(sql: Sql, body: (tx: TransactionSql) => Promise<T>): Promise<T> {
    let result: T | undefined;
    await sql.begin(async (tx) => {
        result = await body(tx);
        throw ROLLBACK;
    }).catch((err: unknown) => {
        if (err !== ROLLBACK) throw err;
    });
    return result as T;
}

/** A Maplify sighting observed `hoursAgo` before the transaction started, far from every other seeded row. */
const insertSighting = (tx: TransactionSql, id: number, hoursAgo: number) => tx`
    insert into maplify.sightings
        (id, project_id, trip_id, scientific_name, entity_id, location, number_sighted, created_at, in_ocean, moderated, trusted, is_test, source)
    values (${id}, 7, 1, 'Orcinus orca', 'SSA:0000900', gis.ST_Point(-123.9876, 48.1234)::gis.geography, 1,
            (now() - make_interval(hours => ${hoursAgo})) at time zone 'GMT', true, 0, false, false, 'test')`;

/** occurrence_days as anon, summed over a week either side of now, inside our fixture's tiny bbox. */
async function countAsAnon(tx: TransactionSql): Promise<number> {
    await tx`set local role anon`;
    const [row] = await tx`
        select coalesce(sum(occurrence_count), 0)::int as n
        from public.occurrence_days(
            (now() at time zone 'PST8PDT')::date - 7,
            (now() at time zone 'PST8PDT')::date + 1,
            -123.99, 48.12, -123.98, 48.13)`;
    await tx`reset role`;
    return row?.['n'] as number;
}

describe.skipIf(!DSN)('occurrence_days (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN!, { max: 1 }); });
    afterAll(async () => { await sql?.end(); });

    test('a sighting from the last 48 hours counts as soon as it is saved', async () => {
        const n = await rolledBack(sql, async (tx) => {
            await insertSighting(tx, RECENT, 1);
            return countAsAnon(tx);
        });
        expect(n).toBe(1);
    });

    test('so does an older one, with no refresh to wait for', async () => {
        const n = await rolledBack(sql, async (tx) => {
            await insertSighting(tx, RECENT, 1);
            await insertSighting(tx, OLDER, 24 * 5);
            return countAsAnon(tx);
        });
        expect(n).toBe(2);
    });

    test('a sighting outside the bbox does not count', async () => {
        const n = await rolledBack(sql, async (tx) => {
            await insertSighting(tx, OLDER, 24 * 5);
            await tx`update maplify.sightings set location = gis.ST_Point(-122.5, 47.6)::gis.geography where id = ${OLDER}`;
            return countAsAnon(tx);
        });
        expect(n).toBe(0);
    });
});
