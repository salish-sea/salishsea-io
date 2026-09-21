/**
 * Where a DarwinCore record's classification comes from (decision 047,
 * migration 20260921020000).
 *
 * Every property here fails silently if broken, and two of them fail by REMOVING data
 * rather than corrupting it, which no consumer would report:
 *
 *   - Both branches of `dwc.occurrences` INNER JOIN `dwc.taxa_classification`. A taxon
 *     missing from the view does not lose its classification columns; the occurrence
 *     vanishes from the archive. A register-only implementation would have dropped 23.6%
 *     of records and produced a smaller archive that passed every other check.
 *   - `kingdom` must stay `Animalia`. The register says `Metazoa`, which is correct and
 *     which GBIF's backbone does not index. Nothing downstream would complain.
 *
 * Self-seeding where it can be, because CI runs `pnpm test` against a database whose
 * `ci-seed.sql` never loads `register.*` — assertions that need a loaded edition are
 * `skipIf` and reported as skipped, never silently passed.
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
        const [row] = await probe<{n: number}[]>`SELECT count(*)::int AS n FROM register.classification`;
        return (row?.n ?? 0) > 0;
    } catch {
        return false;
    } finally {
        await probe.end();
    }
})();

describe.skipIf(!DSN)('dwc classification (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN as string, {prepare: false, max: 1}); });
    afterAll(async () => { await sql.end(); });

    test('the view keeps its exact shape, including order_ and the columns a rewrite dropped', async () => {
        // A first draft of the migration dropped taxon_rank, scientific_name and the genus
        // gate. CREATE OR REPLACE VIEW refused it — "cannot drop columns from view" — which
        // is the only part of this change Postgres catches on its own. This asserts the
        // rest of the contract, including that `order_` keeps its trailing underscore.
        const cols = await sql<{attname: string}[]>`
            SELECT attname FROM pg_attribute
            WHERE attrelid = 'dwc.taxa_classification'::regclass AND attnum > 0
            ORDER BY attnum`;
        expect(cols.map(c => c.attname)).toEqual([
            'taxon_id', 'taxon_rank', 'scientific_name',
            'kingdom', 'phylum', 'class', 'order_', 'family', 'genus',
        ]);
    });

    test('dwc.occurrences INNER JOINs the classification, so a missing row drops the record', async () => {
        // Not a style note: it is why the iNaturalist fallback cannot be removed. If this
        // ever becomes a LEFT JOIN the fallback becomes optional and this test should be
        // rewritten deliberately, not deleted.
        for (const view of ['_native_occurrences', '_maplify_occurrences']) {
            const [{ def }] = await sql<{def: string}[]>`
                SELECT pg_get_viewdef(${'dwc.' + view}::regclass, true) AS def`;
            expect(def, view).toMatch(/\bJOIN dwc\.taxa_classification\b/i);
            // Every form that would make the join non-eliminating, not just LEFT: a RIGHT
            // or FULL join changes the row set too, CROSS discards the key entirely, and
            // OUTER is optional in the spelling Postgres prints.
            expect(def, `${view} must not outer-join the classification without revisiting decision 047`)
                .not.toMatch(/\b(LEFT|RIGHT|FULL|CROSS)\s+(OUTER\s+)?JOIN\s+dwc\.taxa_classification\b/i);
        }
    });

    test.skipIf(!loaded)('kingdom is Animalia everywhere, never the register\'s Metazoa', async () => {
        // The single value we decline to take from the register (decision 047). NCBI is
        // right and GBIF's backbone does not index its answer.
        // NEVER Metazoa: that is the decision, and it holds for every row in the view.
        const metazoa = await sql<{scientific_name: string}[]>`
            SELECT scientific_name FROM dwc.taxa_classification WHERE kingdom = 'Metazoa'`;
        expect(metazoa).toEqual([]);

        // And Animalia for everything actually exported. Deliberately scoped to the export
        // rather than the whole view: `dwc.taxa_classification` covers the entire
        // iNaturalist mirror, which in production holds 10 taxa under `Viruses` and one
        // with no kingdom at all. None of them reach an occurrence, and asserting
        // "Animalia everywhere" fails on them — as an earlier draft of this test did,
        // which is how they were found.
        const exported = await sql<{kingdom: string | null; n: number}[]>`
            SELECT c.kingdom, count(*)::int AS n
            FROM dwc.taxa_classification c
            WHERE EXISTS (SELECT 1 FROM public.observations o WHERE o.taxon_id = c.taxon_id)
               OR EXISTS (SELECT 1 FROM maplify.sightings s WHERE s.taxon_id = c.taxon_id)
            GROUP BY 1`;
        for (const row of exported) expect(row.kingdom, `${row.n} exported rows`).toBe('Animalia');

        // The register really is saying Metazoa, so the first assertion is not vacuous.
        const [{ saysMetazoa }] = await sql<{saysMetazoa: number}[]>`
            SELECT count(*)::int AS "saysMetazoa" FROM register.classification WHERE kingdom = 'Metazoa'`;
        expect(saysMetazoa, 'register asserts Metazoa; the view is overriding it').toBeGreaterThan(0);
    });

    test.skipIf(!loaded)('a subspecies takes its species\' lineage from the register', async () => {
        // Orcinus orca ater is 4,707 exported records and has no register entity of its
        // own — the register holds species and ecotypes, not subspecies. Without the
        // species hop it would fall through to iNaturalist, or under a register-only
        // implementation vanish from the archive entirely.
        // A SENTINEL, because the two sources agree. iNaturalist and NCBI both say
        // Delphinidae/Orcinus, so comparing the subspecies against the species proves
        // nothing: the row would match with the register lookup removed entirely. Writing a
        // value no authority holds, inside a rolled-back transaction, is the only way to
        // show which branch the view actually read.
        await sql.begin(async tx => {
            const rows = await tx<{scientific_name: string; family: string; genus: string}[]>`
                SELECT scientific_name, family, genus FROM dwc.taxa_classification
                WHERE scientific_name IN ('Orcinus orca', 'Orcinus orca ater')
                ORDER BY scientific_name`;
            // Asserted, not guarded: an earlier draft wrapped this in `if (rows.length === 2)`,
            // which passes silently on a mirror not holding the subspecies.
            expect(rows.map(r => r.scientific_name)).toEqual(['Orcinus orca', 'Orcinus orca ater']);

            const [{ n }] = await tx<{n: number}[]>`
                UPDATE register.classification SET family = 'SentinelFamilyNotInAnyAuthority'
                WHERE scientific_name = 'Orcinus orca' RETURNING 1 AS n`;
            expect(n, 'the register must hold Orcinus orca for this to test anything').toBe(1);

            const after = await tx<{scientific_name: string; family: string}[]>`
                SELECT scientific_name, family FROM dwc.taxa_classification
                WHERE scientific_name IN ('Orcinus orca', 'Orcinus orca ater')
                ORDER BY scientific_name`;
            // The species reads the register directly; the subspecies reaches the same row
            // by resolving to its species first. Both must move, or the hop is not happening.
            expect(after.map(r => r.family))
                .toEqual(['SentinelFamilyNotInAnyAuthority', 'SentinelFamilyNotInAnyAuthority']);
            throw new Rollback();
        }).catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
    });

    test.skipIf(!loaded)('a taxon the register does not know keeps iNaturalist\'s lineage', async () => {
        // Delphinapterus leucas and Eubalaena are strays: the register scopes itself to the
        // Salish Sea's animals. 4 exported records that exist only because of the fallback.
        const [stray] = await sql<{family: string; kingdom: string}[]>`
            SELECT family, kingdom FROM dwc.taxa_classification
            WHERE scientific_name = 'Delphinapterus leucas'`;
        // Asserted rather than iterated: `for (const r of rows)` over an empty result is a
        // test that passes by doing nothing.
        expect(stray, 'the mirror must hold this taxon for the fallback to be exercised').toBeDefined();
        expect(stray?.kingdom).toBe('Animalia');
        expect(stray?.family, 'fallback must still supply a family').toBeTruthy();
        const [{ inRegister }] = await sql<{inRegister: number}[]>`
            SELECT count(*)::int AS "inRegister" FROM register.classification
            WHERE scientific_name = 'Delphinapterus leucas'`;
        expect(inRegister, 'if the register gains this taxon the test is no longer about the fallback').toBe(0);
    });

    test.skipIf(!loaded)('every exported record still has a classification row', async () => {
        // The archive-shrinking failure, asserted directly. Any taxon reachable from an
        // occurrence must resolve, or that occurrence is silently not exported.
        // BOTH export branches, not just one. dwc.occurrences unions _native_occurrences
        // (public.observations) and _maplify_occurrences (maplify.sightings); checking only
        // the iNaturalist mirror would leave the Maplify half of the archive unguarded
        // against exactly the failure this test exists for.
        const orphaned = await sql<{taxon_id: number; source: string}[]>`
            SELECT taxon_id, 'public.observations' AS source FROM public.observations o
             WHERE o.taxon_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM dwc.taxa_classification c WHERE c.taxon_id = o.taxon_id)
            UNION
            SELECT taxon_id, 'maplify.sightings' FROM maplify.sightings s
             WHERE s.taxon_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM dwc.taxa_classification c WHERE c.taxon_id = s.taxon_id)`;
        expect(orphaned).toEqual([]);
    });

    test.skipIf(!loaded)('the genus gate still applies to the register\'s genus', async () => {
        // A record identified only to a family has no genus, whichever authority supplied
        // the lineage. Dropping the gate would publish a genus for a family-level record.
        const [{ bad }] = await sql<{bad: number}[]>`
            SELECT count(*)::int AS bad FROM dwc.taxa_classification
            WHERE genus IS NOT NULL
              AND taxon_rank NOT IN ('genus','genushybrid','subgenus','species','complex',
                                     'section','subsection','hybrid','subspecies','variety',
                                     'form','infrahybrid')`;
        expect(bad).toBe(0);
    });
});

class Rollback extends Error {}
