/**
 * Matriline membership as the register says it (salish-ox2.5, migration 20260923010000).
 *
 * The register defines a matriline as a female and all her descendants, so a
 * matriarch belongs to her own matriline AND to her mother's. Our own rows never said so,
 * which is what this view replaces. The seeded graph below is the smallest one that has
 * that shape:
 *
 *   M   (matriarch A)            A, B, C, D
 *   └─ S (matriarch B, A's daughter)   B, C
 *
 * D is dead; the view includes her, because membership is not life status.
 *
 * Seeded rather than read from a loaded edition, so it runs in CI, where `register.*` is
 * empty (see register-ancestry.test.ts for why that split matters). Identifiers are well
 * outside anything the register mints.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';

const DSN = process.env['SUPABASE_DB_URL'];

const M = 'SSA:9702001';
const S = 'SSA:9702002';
const A = 'SSA:9710001';
const B = 'SSA:9710002';
const C = 'SSA:9710003';
const D = 'SSA:9710004';

class Rollback extends Error {}

describe.skipIf(!DSN)('matriline_members (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN as string, {prepare: false, max: 1}); });
    afterAll(async () => { await sql.end(); });

    type Row = { group: string; animal: string; innermost: string };

    const withGraph = async (body: (tx: Sql) => Promise<void>) => {
        await sql.begin(async tx => {
            await tx`INSERT INTO register.entities (entity_id, kind, rank, label) VALUES
                (${M}, 'group', 'matriline', 'TX1s'), (${S}, 'group', 'matriline', 'TX1As'),
                (${A}, 'individual', NULL, 'TX1'), (${B}, 'individual', NULL, 'TX1A'),
                (${C}, 'individual', NULL, 'TX1A1'), (${D}, 'individual', NULL, 'TX1B')`;
            // The closure as the register publishes it: every animal under M, B and C also
            // under S, and S itself under M.
            await tx`INSERT INTO register.ancestor (entity_id, ancestor_id, depth, ancestor_kind) VALUES
                (${A}, ${M}, 1, 'group'), (${B}, ${M}, 1, 'group'), (${C}, ${M}, 1, 'group'),
                (${D}, ${M}, 1, 'group'), (${B}, ${S}, 1, 'group'), (${C}, ${S}, 1, 'group'),
                (${S}, ${M}, 1, 'group')`;
            await tx`INSERT INTO public.social_groups (kind, designation, entity_id) VALUES
                ('matriline', 'TX1', ${M}), ('matriline', 'TX1A', ${S})`;
            await tx`INSERT INTO public.individuals (primary_designation, entity_id, life_status) VALUES
                ('TX1', ${A}, 'alive'), ('TX1A', ${B}, 'alive'),
                ('TX1A1', ${C}, 'alive'), ('TX1B', ${D}, 'deceased')`;
            await body(tx);
            throw new Rollback();
        }).catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
    };

    const members = (tx: Sql) => tx<Row[]>`
        SELECT g.designation AS group, i.primary_designation AS animal, n.designation AS innermost
        FROM public.matriline_members m
        JOIN public.social_groups g ON g.id = m.group_id
        JOIN public.individuals i ON i.id = m.individual_id
        JOIN public.social_groups n ON n.id = m.innermost_group_id
        WHERE i.entity_id IN (${A}, ${B}, ${C}, ${D})
        ORDER BY 1, 2`;

    test('a matriarch is a member of her own matriline and of her mother\'s', async () => {
        await withGraph(async tx => {
            const rows = await members(tx);
            expect(rows.filter(r => r.animal === 'TX1A').map(r => r.group)).toEqual(['TX1', 'TX1A']);
            expect(rows.filter(r => r.animal === 'TX1').map(r => r.group)).toEqual(['TX1']);
        });
    });

    test('a matriline holds every descendant, grandchildren included, dead or alive', async () => {
        await withGraph(async tx => {
            const rows = await members(tx);
            expect(rows.filter(r => r.group === 'TX1').map(r => r.animal))
                .toEqual(['TX1', 'TX1A', 'TX1A1', 'TX1B']);
        });
    });

    test('each animal has one innermost matriline, the narrowest that holds her', async () => {
        await withGraph(async tx => {
            const innermost = new Map((await members(tx)).map(r => [r.animal, r.innermost]));
            expect(Object.fromEntries(innermost)).toEqual({
                TX1: 'TX1', TX1A: 'TX1A', TX1A1: 'TX1A', TX1B: 'TX1',
            });
        });
    });
});
