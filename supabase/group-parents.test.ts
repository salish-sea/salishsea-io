/**
 * A group's parent is the register's (decision 051, migration 20260923020000).
 *
 * public.group_parents reads the register's closure, so each group has every ancestor
 * listed and the view must pick the nearest one we catalogue. The seeded tree has one of
 * each case:
 *
 *   E  ecotype (catalogued)
 *   └─ P  pod (register only — we have no row for it)
 *      └─ M  matriline (catalogued)
 *         └─ S  sub-lineage (catalogued)
 *
 * Seeded rather than read from a loaded edition, so it runs in CI, where `register.*` is
 * empty. Identifiers are well outside anything the register mints.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';

const DSN = process.env['SUPABASE_DB_URL'];

const E = 'SSA:9703001';
const P = 'SSA:9703002';
const M = 'SSA:9703003';
const S = 'SSA:9703004';

class Rollback extends Error {}

describe.skipIf(!DSN)('group_parents (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN as string, {prepare: false, max: 1}); });
    afterAll(async () => { await sql.end(); });

    const parents = async () => {
        let result: Record<string, string | null> = {};
        await sql.begin(async tx => {
            await tx`INSERT INTO register.entities (entity_id, kind, rank, label) VALUES
                (${E}, 'group', 'ecotype', 'TX ecotype'), (${P}, 'group', 'pod', 'TX pod'),
                (${M}, 'group', 'matriline', 'TX1s'), (${S}, 'group', 'matriline', 'TX1As')`;
            await tx`INSERT INTO register.ancestor (entity_id, ancestor_id, depth, ancestor_kind) VALUES
                (${P}, ${E}, 1, 'group'),
                (${M}, ${P}, 1, 'group'), (${M}, ${E}, 2, 'group'),
                (${S}, ${M}, 1, 'group'), (${S}, ${P}, 2, 'group'), (${S}, ${E}, 3, 'group')`;
            await tx`INSERT INTO public.social_groups (kind, designation, entity_id) VALUES
                ('ecotype', 'TXE', ${E}), ('matriline', 'TX1', ${M}), ('matriline', 'TX1A', ${S})`;
            const rows = await tx<{ group: string; parent: string | null }[]>`
                SELECT g.designation AS group, p.designation AS parent
                FROM public.social_groups g
                LEFT JOIN public.group_parents gp ON gp.group_id = g.id
                LEFT JOIN public.social_groups p ON p.id = gp.parent_group_id
                WHERE g.entity_id IN (${E}, ${M}, ${S})`;
            result = Object.fromEntries(rows.map(r => [r.group, r.parent]));
            throw new Rollback();
        }).catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
        return result;
    };

    test('each group\'s parent is its nearest catalogued ancestor, stepping over groups we do not hold', async () => {
        expect(await parents()).toEqual({ TXE: null, TX1: 'TXE', TX1A: 'TX1' });
    });
});
