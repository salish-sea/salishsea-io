/**
 * The register's names, reachable from the browser (migration 20260922010000).
 *
 * This view exists so the individual profile page can stop carrying its own table of
 * animal names. Everything it can get wrong is silent: a missing grant renders a profile
 * with no species line rather than an error, and a tie-break that drifts from
 * `register.inaturalist_taxon_name` makes the map and the profile page disagree about what
 * one animal is called, on two screens nobody compares.
 *
 * The anon test is the load-bearing one. Unlike the `register` tables — which anon may
 * read but PostgREST never exposes — this view is fetched by the browser directly.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';

const DSN = process.env['SUPABASE_DB_URL'];

/** See supabase/register-ancestry.test.ts: skipIf is read at collection time, before hooks. */
const loaded = await (async () => {
    if (!DSN) return false;
    const probe = postgres(DSN, {prepare: false, max: 1});
    try {
        const [row] = await probe<{n: number}[]>`SELECT count(*)::int AS n FROM register.entities`;
        return (row?.n ?? 0) > 0;
    } catch { return false; } finally { await probe.end(); }
})();

describe.skipIf(!DSN)('public.animal_names (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN as string, {prepare: false, max: 1}); });
    afterAll(async () => { await sql.end(); });

    test('anon can read it, because the browser does', async () => {
        // The register tables are granted to anon too, but PostgREST cannot reach that
        // schema. This one it can, so the grant is what the page actually depends on.
        await sql.begin(async tx => {
            await tx`SET LOCAL ROLE anon`;
            const rows = await tx`SELECT entity_id, common_name, taxon_common_name
                                  FROM public.animal_names LIMIT 1`;
            expect(Array.isArray(rows)).toBe(true);
        });
    });

    test.skipIf(!loaded)('an ecotype is named, and reaches the species above it', async () => {
        // The two strings the profile page chooses between. SSA:0000002 is the only ecotype
        // in the catalogue's group graph, so this pair is the whole of what the page renders.
        const [biggs] = await sql<{common_name: string; taxon_entity_id: string; taxon_common_name: string}[]>`
            SELECT common_name, taxon_entity_id, taxon_common_name
            FROM public.animal_names WHERE entity_id = 'SSA:0000002'`;
        expect(biggs).toEqual({
            common_name: "Bigg's killer whale",
            taxon_entity_id: 'SSA:0000900',
            taxon_common_name: 'Killer whale',
        });
    });

    test.skipIf(!loaded)('a taxon is its own taxon, so the fallback terminates', async () => {
        const [orca] = await sql<{common_name: string; taxon_entity_id: string}[]>`
            SELECT common_name, taxon_entity_id FROM public.animal_names
            WHERE entity_id = 'SSA:0000900'`;
        expect(orca).toMatchObject({ common_name: 'Killer whale', taxon_entity_id: 'SSA:0000900' });
    });

    test.skipIf(!loaded)('it agrees with the map about every animal they both name', async () => {
        // The drift that would otherwise show "Harbour seal" on a pin and something else on
        // a profile.
        //
        // WEAKER THAN IT LOOKS, and the next test is why: 38 entities carry more than one
        // common name and NONE of them are crosswalked to iNaturalist, so this join only
        // ever compares entities with exactly one candidate. It catches a different
        // SELECTION rule — reading `hidden`, say — and cannot catch a different tie-break.
        const disagreements = await sql<{entity_id: string; here: string; on_the_map: string}[]>`
            SELECT a.entity_id, a.common_name AS here, m.common_name AS on_the_map
            FROM public.animal_names a
            JOIN register.inaturalist_taxon_name m ON m.entity_id = a.entity_id
            WHERE a.common_name IS DISTINCT FROM m.common_name`;
        expect(disagreements).toEqual([]);
    });

    test('the tie-break is English first, then shortest, then alphabetical', async () => {
        // Seeded, because the register offers no crosswalked entity with two common names
        // to observe it on. The order matters: an entity that gains a second name must not
        // silently change what a profile page calls it, and `register.inaturalist_taxon_name`
        // sorts the same way so the two surfaces cannot drift apart.
        await sql.begin(async tx => {
            await tx`INSERT INTO register.entities (entity_id, kind, label)
                     VALUES ('SSA:9500001', 'taxon', 'Multinomial')`;
            await tx`INSERT INTO register.names (entity_id, name, type, language) VALUES
                     ('SSA:9500001', 'Aaaa non-English', 'common', 'fr'),
                     ('SSA:9500001', 'Zzzz short', 'common', 'en'),
                     ('SSA:9500001', 'Bbbb much longer English name', 'common', 'en')`;
            const [row] = await tx<{common_name: string}[]>`
                SELECT common_name FROM public.animal_names WHERE entity_id = 'SSA:9500001'`;
            // English beats the alphabetically-first French; among the English, the shorter.
            expect(row?.common_name).toBe('Zzzz short');
            throw new Rollback();
        }).catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
    });

    test.skipIf(!loaded)('a hidden or preferred name is never offered as the common one', async () => {
        // animals ADR-0011: a `hidden` name is evidence a string is in use, not one the
        // register offers, and `preferred` is a designation ('J17s') rather than English.
        const leaked = await sql<{entity_id: string; common_name: string}[]>`
            SELECT a.entity_id, a.common_name FROM public.animal_names a
            WHERE a.common_name IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM register.names n
                              WHERE n.entity_id = a.entity_id
                                AND n.name = a.common_name AND n.type = 'common')`;
        expect(leaked).toEqual([]);
    });

    test('an entity with no common name still appears, with NULL rather than no row', async () => {
        // The real hazard, and not the one about LATERAL: if the name were fetched by
        // joining register.names instead of by a correlated subquery, the 360 entities the
        // register has not given a common name would vanish from this view — and a profile
        // page would render no species line rather than falling back to the taxon.
        //
        // (The LEFT JOIN on register.taxon_for() is defensive only: that function is total
        // over every entity today and returns a scalar, so LATERAL yields a row either way.)
        await sql.begin(async tx => {
            await tx`INSERT INTO register.entities (entity_id, kind, label)
                     VALUES ('SSA:9500002', 'group', 'Nameless')`;
            const rows = await tx<{common_name: string | null}[]>`
                SELECT common_name FROM public.animal_names WHERE entity_id = 'SSA:9500002'`;
            expect(rows).toHaveLength(1);
            expect(rows[0]?.common_name).toBeNull();
            throw new Rollback();
        }).catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
    });
});

class Rollback extends Error {}
