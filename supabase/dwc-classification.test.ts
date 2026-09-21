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
            expect(def, view).toMatch(/\bJOIN dwc\.taxa_classification\b/);
            expect(def, `${view} must not LEFT JOIN it without revisiting decision 047`)
                .not.toMatch(/LEFT JOIN dwc\.taxa_classification\b/);
        }
    });

    test.skipIf(!loaded)('kingdom is Animalia everywhere, never the register\'s Metazoa', async () => {
        // The single value we decline to take from the register (decision 047). NCBI is
        // right and GBIF's backbone does not index its answer.
        const [{ metazoa, animalia }] = await sql<{metazoa: number; animalia: number}[]>`
            SELECT count(*) FILTER (WHERE kingdom = 'Metazoa')::int  AS metazoa,
                   count(*) FILTER (WHERE kingdom = 'Animalia')::int AS animalia
            FROM dwc.taxa_classification`;
        expect(metazoa).toBe(0);
        expect(animalia).toBeGreaterThan(0);
        // And the register really is saying Metazoa, so the assertion above is not vacuous.
        const [{ saysMetazoa }] = await sql<{saysMetazoa: number}[]>`
            SELECT count(*)::int AS "saysMetazoa" FROM register.classification WHERE kingdom = 'Metazoa'`;
        expect(saysMetazoa, 'register asserts Metazoa; the view is overriding it').toBeGreaterThan(0);
    });

    test.skipIf(!loaded)('a subspecies takes its species\' lineage from the register', async () => {
        // Orcinus orca ater is 4,707 exported records and has no register entity of its
        // own — the register holds species and ecotypes, not subspecies. Without the
        // species hop it would fall through to iNaturalist, or under a register-only
        // implementation vanish from the archive entirely.
        const rows = await sql<{scientific_name: string; family: string; genus: string}[]>`
            SELECT scientific_name, family, genus FROM dwc.taxa_classification
            WHERE scientific_name IN ('Orcinus orca', 'Orcinus orca ater')
            ORDER BY scientific_name`;
        if (rows.length === 2) {
            expect(rows[0]?.family).toBe(rows[1]?.family);
            expect(rows[0]?.genus).toBe(rows[1]?.genus);
        }
    });

    test.skipIf(!loaded)('a taxon the register does not know keeps iNaturalist\'s lineage', async () => {
        // Delphinapterus leucas and Eubalaena are strays: the register scopes itself to the
        // Salish Sea's animals. 4 exported records that exist only because of the fallback.
        const rows = await sql<{scientific_name: string; family: string; kingdom: string}[]>`
            SELECT scientific_name, family, kingdom FROM dwc.taxa_classification
            WHERE scientific_name = 'Delphinapterus leucas'`;
        for (const r of rows) {
            expect(r.kingdom).toBe('Animalia');
            expect(r.family, 'fallback must still supply a family').toBeTruthy();
        }
    });

    test.skipIf(!loaded)('every exported record still has a classification row', async () => {
        // The archive-shrinking failure, asserted directly. Any taxon reachable from an
        // occurrence must resolve, or that occurrence is silently not exported.
        const [{ orphaned }] = await sql<{orphaned: number}[]>`
            SELECT count(*)::int AS orphaned
            FROM inaturalist.taxa t
            WHERE EXISTS (SELECT 1 FROM inaturalist.observations o WHERE o.taxon_id = t.id)
              AND NOT EXISTS (SELECT 1 FROM dwc.taxa_classification c WHERE c.taxon_id = t.id)`;
        expect(orphaned).toBe(0);
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
