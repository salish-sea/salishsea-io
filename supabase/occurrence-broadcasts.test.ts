/**
 * The occurrences_changed broadcast fires once per transaction that changed a
 * row, and not at all for a statement that changed nothing (bd salish-xfo).
 *
 * Every open map refetches the day's sightings when this broadcast arrives.
 * With statement-level triggers the ingest sent four per tick — one per
 * INSERT and DELETE statement, rows changed or not — so every tab ran the
 * day's query four times, at once, while the database was still inside the
 * tick's writes; that is where a visitor's query met the 3s anon
 * statement_timeout (SALISHSEA-IO-3D). Migration 20260910120000 makes the
 * triggers row-level with a transaction-local once-only flag. Nothing in the
 * schema stops a later migration from recreating them FOR EACH STATEMENT, and
 * the symptom would be the same intermittent timeout weeks later — hence a
 * test.
 *
 * Every write here happens inside a transaction that is rolled back, so the
 * suite leaves the seeded database as it found it. realtime.send inserts into
 * realtime.messages in the same transaction, which is what lets the count be
 * read back before the rollback. Gated on SUPABASE_DB_URL like the other
 * integration tiers (decision 011): it skips on a fresh checkout and runs in CI.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import type { Sql, TransactionSql } from 'postgres';

const DSN = process.env['SUPABASE_DB_URL'];

/** Ids in the band persist.test.ts reserves for test rows; the rollback removes them anyway. */
const IDS = [900801, 900802];

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

/**
 * Broadcasts this transaction has queued. realtime.messages.inserted_at
 * defaults to now(), which is the transaction's start time, so equality picks
 * out our rows. (Not xmin: realtime.send inserts inside an EXCEPTION block,
 * a subtransaction with an xid of its own.)
 */
async function broadcastsSoFar(tx: TransactionSql): Promise<number> {
    const [row] = await tx`
        select count(*)::int as n
        from realtime.messages
        where topic = 'occurrences' and event = 'occurrences_changed'
          and inserted_at = now()`;
    return row?.['n'] as number;
}

const insertSightings = (tx: TransactionSql, ids: number[]) => tx`
    insert into maplify.sightings
        (id, project_id, trip_id, scientific_name, location, number_sighted, created_at, in_ocean, moderated, trusted, is_test, source)
    select id, 7, 1, 'Orcinus orca', gis.ST_Point(-123, 48)::gis.geography, 1, '2026-07-03 10:00', true, 0, false, false, 'test'
    from unnest(${ids}::int[]) as id`;

describe.skipIf(!DSN)('occurrences_changed broadcast (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN!, { max: 1 }); });
    afterAll(async () => { await sql?.end(); });

    test('a transaction that writes several rows in several statements broadcasts once', async () => {
        const n = await rolledBack(sql, async (tx) => {
            await insertSightings(tx, IDS);
            await tx`update maplify.sightings set number_sighted = 2 where id = any(${IDS}::int[])`;
            await tx`delete from maplify.sightings where id = ${IDS[0]!}`;
            return broadcastsSoFar(tx);
        });
        expect(n).toBe(1);
    });

    test('a statement that changes no rows broadcasts nothing', async () => {
        const n = await rolledBack(sql, async (tx) => {
            await tx`delete from maplify.sightings where id = ${IDS[0]!}`;
            await tx`update maplify.sightings set number_sighted = 2 where id = ${IDS[0]!}`;
            return broadcastsSoFar(tx);
        });
        expect(n).toBe(0);
    });

    test('the once-only flag is scoped to the transaction', async () => {
        // Two transactions on one connection: the second must broadcast again.
        const first = await rolledBack(sql, async (tx) => {
            await insertSightings(tx, [IDS[0]!]);
            return broadcastsSoFar(tx);
        });
        const second = await rolledBack(sql, async (tx) => {
            await insertSightings(tx, [IDS[1]!]);
            return broadcastsSoFar(tx);
        });
        expect([first, second]).toEqual([1, 1]);
    });

    test('every table feeding the occurrences view is wired the same way', async () => {
        const rows = await sql<{ tbl: string; row_level: boolean; fn: string }[]>`
            select t.tgrelid::regclass::text as tbl,
                   (t.tgtype & 1) = 1 as row_level,
                   t.tgfoid::regproc::text as fn
            from pg_trigger t
            where t.tgname like 'occurrences_changed_after_%' and not t.tgisinternal
            order by 1`;
        expect(rows).toEqual([
            { tbl: 'happywhale.encounters', row_level: true, fn: 'notify_occurrences_changed' },
            { tbl: 'inaturalist.observations', row_level: true, fn: 'notify_occurrences_changed' },
            { tbl: 'maplify.sightings', row_level: true, fn: 'notify_occurrences_changed' },
            { tbl: 'observations', row_level: true, fn: 'notify_occurrences_changed' },
        ]);
    });
});
