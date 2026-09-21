/**
 * Walking a register entity up to the taxon it belongs to (salish-53t.1,
 * migration 20260921010000).
 *
 * The point of these functions is that an occurrence can be identified by a register
 * entity alone — "J pod", with no iNaturalist taxon anywhere — and still get a species.
 * Orcasound bouts are the first such source (salish-8vr.26).
 *
 * TWO KINDS OF TEST HERE, AND THE SPLIT IS DELIBERATE.
 *
 * The logic tests SEED THEIR OWN GRAPH and run everywhere, including CI. They have to:
 * `.github/workflows/build.yml` runs `pnpm test` with SUPABASE_DB_URL set against a
 * database seeded by `supabase/ci-seed.sql`, which does not touch `register.*` and never
 * runs the loader. An earlier draft of this file guarded every assertion with
 * `if (!loaded) return`, which made the whole file a no-op in CI while reporting green —
 * the exact vacuous-test failure this repo has been bitten by before.
 *
 * The edition tests assert things about the register actually loaded — that 773 real
 * entities all resolve, that the real J pod chain is what the migration header claims.
 * Those cannot be faked, so they are `skipIf(!loaded)` and vitest REPORTS them as skipped
 * rather than passing them silently. A skip you can see is a different thing from an
 * assertion that quietly evaporated.
 *
 * Load the register locally to run them:
 *   SUPABASE_DB_URL=… pnpm -s exec tsx scripts/register/load.ts --tag 2026.09.3 --apply
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';

const DSN = process.env['SUPABASE_DB_URL'];

/** Identifiers well outside anything the register mints, so a seed cannot collide. */
const T = 'SSA:9700900';  // a taxon
const ECO = 'SSA:9700003';  // an ecotype, kind=group — walked PAST, never returned
const POD = 'SSA:9700020';  // a pod, the thing an occurrence cites
const GONE = 'SSA:9700001';  // merged into POD's line
const SPLIT = 'SSA:9700002';  // split: deprecated with no single successor

/**
 * Whether an edition is loaded, decided at MODULE scope and not in `beforeAll`.
 *
 * `test.skipIf()` is evaluated when the suite is collected, which happens before any hook
 * runs. A `loaded` flag set in `beforeAll` is therefore still `false` at the moment skipIf
 * reads it, and every edition test is skipped even against a fully loaded register —
 * silently, and reported as a tidy "4 skipped". Top-level await settles it before
 * collection, so the skip reflects the database rather than the evaluation order.
 */
const loaded = await (async () => {
    if (!DSN) return false;
    const probe = postgres(DSN, {prepare: false, max: 1});
    try {
        const [row] = await probe<{n: number}[]>`SELECT count(*)::int AS n FROM register.ancestor`;
        return (row?.n ?? 0) > 0;
    } catch {
        return false;  // no schema yet; the logic tests below will fail loudly instead.
    } finally {
        await probe.end();
    }
})();

describe.skipIf(!DSN)('register ancestry (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN as string, {prepare: false, max: 1}); });
    afterAll(async () => { await sql.end(); });

    /**
     * A miniature of the real shape — pod inside ecotype inside taxon, one merge
     * deprecation, one split — then `body`, then rollback. Mirrors the register's own
     * conventions: no depth-0 self row, and the ecotype is a `group` so the resolver has
     * something it must walk past rather than return.
     */
    const withGraph = async (sqlc: Sql, body: (tx: Sql) => Promise<void>) => {
        await sqlc.begin(async tx => {
            await tx`INSERT INTO register.entities (entity_id, kind, rank, label) VALUES
                (${T},   'taxon',  NULL,      'Testus animalis'),
                (${ECO}, 'group',  'ecotype', 'Test ecotype'),
                (${POD}, 'group',  'pod',     'Test pod'),
                (${GONE},'group',  'ecotype', 'Merged away'),
                (${SPLIT},'group', 'pod',     'Split away')`;
            await tx`INSERT INTO register.names (entity_id, name, type, language) VALUES
                (${T}, 'Test animal', 'common', 'en')`;
            await tx`INSERT INTO register.membership (member_id, group_id) VALUES
                (${POD}, ${ECO}), (${ECO}, ${T})`;
            await tx`INSERT INTO register.ancestor (entity_id, ancestor_id, depth, ancestor_kind) VALUES
                (${POD}, ${ECO}, 1, 'group'), (${POD}, ${T}, 2, 'taxon'),
                (${ECO}, ${T},   1, 'taxon'),
                (${GONE}, ${T},  1, 'taxon'),
                (${SPLIT}, ${T}, 1, 'taxon')`;
            await tx`INSERT INTO register.deprecations (entity_id, reason, replaced_by, consider) VALUES
                (${GONE},  'merged', ${POD}, NULL),
                (${SPLIT}, 'split',  NULL,   ${POD})`;
            await body(tx);
            throw new Rollback();
        }).catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
    };

    // ---- logic, seeded here, runs in CI ------------------------------------

    test('a pod resolves to the taxon above it, walking past the ecotype', async () => {
        await withGraph(sql, async tx => {
            const [{ r }] = await tx<{r: string}[]>`SELECT register.taxon_entity_for(${POD}) AS r`;
            expect(r).toBe(T);
        });
    });

    test('a taxon is its own answer, which needs the kind test because there is no depth-0 row', async () => {
        await withGraph(sql, async tx => {
            const [{ n }] = await tx<{n: number}[]>`
                SELECT count(*)::int AS n FROM register.ancestor WHERE entity_id = ${T}`;
            expect(n, 'fixture has no self row, like the register').toBe(0);
            const [{ r }] = await tx<{r: string}[]>`SELECT register.taxon_entity_for(${T}) AS r`;
            expect(r).toBe(T);
        });
    });

    test('a MERGED deprecation is followed to its replacement', async () => {
        await withGraph(sql, async tx => {
            const [{ r }] = await tx<{r: string}[]>`SELECT register.taxon_entity_for(${GONE}) AS r`;
            expect(r).toBe(T);
        });
    });

    test('a SPLIT deprecation resolves to NULL rather than guessing a successor', async () => {
        // The bug this exists for: writing the hop as COALESCE(d.replaced_by, e.entity_id)
        // falls back to the TOMBSTONE when replaced_by is NULL, then walks its ancestors
        // and returns a species for an identifier the register deliberately refused to
        // redirect. Worse than a gap, because it looks like an answer. The fixture gives
        // SPLIT a real taxon ancestor precisely so the wrong implementation SUCCEEDS here
        // rather than returning NULL for want of anything to find.
        await withGraph(sql, async tx => {
            const [{ reachable }] = await tx<{reachable: number}[]>`
                SELECT count(*)::int AS reachable FROM register.ancestor
                WHERE entity_id = ${SPLIT} AND ancestor_kind = 'taxon'`;
            expect(reachable, 'precondition: a wrong implementation would find this').toBe(1);
            const [{ r }] = await tx<{r: string | null}[]>`SELECT register.taxon_entity_for(${SPLIT}) AS r`;
            expect(r).toBeNull();
        });
    });

    test('an unknown identifier is NULL, not an error', async () => {
        const [{ r }] = await sql<{r: string | null}[]>`
            SELECT register.taxon_entity_for('SSA:9999999') AS r`;
        expect(r).toBeNull();
    });

    test('taxon_for builds a whole public.taxon, keyed on the TAXON entity', async () => {
        // entity_id must be the taxon, not the pod that was cited: SHORT_MAP_FORMS in
        // src/symbology.ts keys on it to shorten a name, so it has to be the thing named.
        // species_id is NULL here because the fixture has no iNaturalist crosswalk; the
        // edition test below covers the real one.
        await withGraph(sql, async tx => {
            const [t] = await tx<{scientific_name: string; vernacular_name: string; entity_id: string}[]>`
                SELECT (register.taxon_for(${POD})).*`;
            expect(t).toMatchObject({
                scientific_name: 'Testus animalis',
                vernacular_name: 'Test animal',
                entity_id: T,
            });
        });
    });

    test('anon can execute both functions and read the new tables', async () => {
        // The caller-rights trap: a SQL function's body is checked against the CALLER, and
        // the planner may inline it into a view that would otherwise run with definer
        // rights. Migration 20260829040000 exists because a table read added inside a
        // function broke production for anon while working perfectly as postgres, which a
        // superuser connection cannot reproduce.
        await sql.begin(async tx => {
            await tx`SET LOCAL ROLE anon`;
            await tx`SELECT register.taxon_entity_for('SSA:0000020')`;
            await tx`SELECT (register.taxon_for('SSA:0000020')).*`;
            for (const table of ['membership', 'ancestor', 'deprecations'])
                expect(Array.isArray(await tx`SELECT 1 FROM register.${tx(table)} LIMIT 1`), table).toBe(true);
        });
    });

    test('the membership constraint permits leaving and rejoining, and refuses a duplicate', async () => {
        // Not a PK on (member_id, group_id): an animal can leave and rejoin, which is two
        // rows differing only in their dates. NULLS NOT DISTINCT is what makes this bite —
        // a plain UNIQUE treats NULLs as distinct, and every real membership row has a
        // NULL end, so the constraint would have guarded nothing at all.
        await sql.begin(async tx => {
            await tx`INSERT INTO register.entities (entity_id, kind, label) VALUES
                     ('SSA:9800001','individual','Test member'), ('SSA:9800002','group','Test group')`;
            await tx`INSERT INTO register.membership (member_id, group_id, start, "end") VALUES
                     ('SSA:9800001','SSA:9800002','1990','1995'),
                     ('SSA:9800001','SSA:9800002','2001', NULL)`;
            await expect(
                tx`INSERT INTO register.membership (member_id, group_id, start, "end")
                   VALUES ('SSA:9800001','SSA:9800002','2001', NULL)`,
            ).rejects.toThrow(/membership_unique/);
            throw new Rollback();
        }).catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
    });

    // ---- the loaded edition; reported as SKIPPED when absent ---------------

    test.skipIf(!loaded)('the real J pod chain is what the migration header claims', async () => {
        const rows = await sql<{ancestor_id: string; ancestor_kind: string}[]>`
            SELECT ancestor_id, ancestor_kind FROM register.ancestor
            WHERE entity_id = 'SSA:0000020' ORDER BY depth`;
        expect(rows.map(r => [r.ancestor_id, r.ancestor_kind])).toEqual([
            ['SSA:0000011', 'group'],  // J clan
            ['SSA:0000010', 'group'],  // Southern Resident
            ['SSA:0000003', 'group'],  // Resident
            ['SSA:0000900', 'taxon'],  // Orcinus orca
        ]);
    });

    test.skipIf(!loaded)('every live or merged entity in the loaded edition resolves to a taxon', async () => {
        // Totality is what salish-8vr.26 depends on: a bout citing any entity the register
        // knows must get a species or it silently vanishes from the map. Split
        // deprecations are excluded because NULL is their correct answer, per above.
        const orphans = await sql<{entity_id: string; kind: string}[]>`
            SELECT e.entity_id, e.kind FROM register.entities e
            LEFT JOIN register.deprecations d ON d.entity_id = e.entity_id
            WHERE register.taxon_entity_for(e.entity_id) IS NULL
              AND NOT (d.entity_id IS NOT NULL AND d.replaced_by IS NULL)`;
        expect(orphans).toEqual([]);
    });

    test.skipIf(!loaded)('the real J pod gets Orcinus orca, named and with a species_id', async () => {
        // species_id matters beyond identification: src/segments.ts refuses to chain two
        // occurrences into one track when it differs, so a bout must carry the same value
        // a sighting of the same animal does.
        const [t] = await sql<{scientific_name: string; vernacular_name: string; species_id: number; entity_id: string}[]>`
            SELECT (register.taxon_for('SSA:0000020')).*`;
        expect(t).toEqual({
            scientific_name: 'Orcinus orca',
            vernacular_name: 'Killer whale',
            species_id: 41521,
            entity_id: 'SSA:0000900',
        });
    });

    test.skipIf(!loaded)('a Bigg\'s sub-lineage stops at the species, not the ecotype', async () => {
        // SSA:0000002 "Bigg's killer whale" now has a name and a crosswalk, but it is
        // kind='group' and ADR-0008 refuses it taxonomic standing; keying species_id on
        // rectipinnus would stop a Bigg's bout ever chaining with a sighting recorded as
        // plain Orcinus orca. The ecotype reaches the map through the label instead.
        const [t] = await sql<{scientific_name: string; entity_id: string; species_id: number}[]>`
            SELECT (register.taxon_for('SSA:0000103')).*`;
        expect(t).toMatchObject({
            scientific_name: 'Orcinus orca', entity_id: 'SSA:0000900', species_id: 41521,
        });
    });
});

class Rollback extends Error {}
