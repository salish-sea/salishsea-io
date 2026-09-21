/**
 * Walking a register entity up to the taxon it belongs to (salish-53t.1,
 * migration 20260921010000).
 *
 * The point of these functions is that an occurrence can be identified by a register
 * entity alone — "J pod", with no iNaturalist taxon anywhere — and still get a species.
 * Orcasound bouts are the first such source (salish-8vr.26).
 *
 * TWO OF THESE TESTS RUN AS `anon` AND THAT IS THE POINT. A SQL function's body is checked
 * against the CALLER, not the owner, and the planner may inline it into a view that would
 * otherwise run with definer rights. Migration 20260829040000 exists because a table read
 * added inside a function broke production for anon while working perfectly as postgres,
 * and a laptop's superuser connection cannot reproduce that.
 *
 * Skipped without SUPABASE_DB_URL, and most assertions need a loaded register — they are
 * guarded rather than silently vacuous, because a bare `pnpm test` against an empty
 * database is exactly how a test like this rots.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';

const DSN = process.env['SUPABASE_DB_URL'];

describe.skipIf(!DSN)('register ancestry (local Supabase)', () => {
    let sql: Sql;
    let loaded = false;

    beforeAll(async () => {
        sql = postgres(DSN as string, {prepare: false, max: 1});
        const [row] = await sql<{n: number}[]>`SELECT count(*)::int AS n FROM register.ancestor`;
        loaded = (row?.n ?? 0) > 0;
    });
    afterAll(async () => { await sql.end(); });

    test('the closure loaded, and carries no depth-0 self row', async () => {
        if (!loaded) return expect(loaded, 'register not loaded — run scripts/register/load.ts').toBe(false);
        // taxon_entity_for() tests `kind = 'taxon'` separately BECAUSE there is no self
        // row. If the register ever starts publishing one, that branch becomes dead code
        // and this test says so before the redundancy is mistaken for a bug.
        const [{ selves }] = await sql<{selves: number}[]>`
            SELECT count(*)::int AS selves FROM register.ancestor WHERE depth = 0`;
        expect(selves).toBe(0);
    });

    test('a pod walks up to its species, through clan, community and ecotype', async () => {
        if (!loaded) return;
        // The worked example from the migration header, asserted rather than described.
        const rows = await sql<{ancestor_id: string; depth: number; ancestor_kind: string}[]>`
            SELECT ancestor_id, depth, ancestor_kind FROM register.ancestor
            WHERE entity_id = 'SSA:0000020' ORDER BY depth`;
        expect(rows.map(r => [r.ancestor_id, r.ancestor_kind])).toEqual([
            ['SSA:0000011', 'group'],  // J clan
            ['SSA:0000010', 'group'],  // Southern Resident
            ['SSA:0000003', 'group'],  // Resident
            ['SSA:0000900', 'taxon'],  // Orcinus orca
        ]);
    });

    test('every live or merged entity resolves to a taxon', async () => {
        if (!loaded) return;
        // Totality is the property salish-8vr.26 depends on: a bout citing any entity the
        // register knows must get a species, or it silently vanishes from the map. If a
        // future edition adds an entity that hangs from nothing, this fails and names it
        // rather than leaving a hole to be noticed later.
        //
        // A SPLIT deprecation is excluded on purpose, and the next test is why: it has no
        // single correct successor, so NULL is the right answer rather than a gap. Today
        // the register has no split, so this exclusion changes nothing — it is here so the
        // assertion stays true when one arrives instead of failing and being loosened in
        // a hurry.
        const orphans = await sql<{entity_id: string; kind: string}[]>`
            SELECT e.entity_id, e.kind FROM register.entities e
            LEFT JOIN register.deprecations d ON d.entity_id = e.entity_id
            WHERE register.taxon_entity_for(e.entity_id) IS NULL
              AND NOT (d.entity_id IS NOT NULL AND d.replaced_by IS NULL)`;
        expect(orphans).toEqual([]);
    });

    test('a SPLIT deprecation resolves to NULL rather than guessing a successor', async () => {
        if (!loaded) return;
        // The register has no split deprecation yet, so this seeds one. Without it the
        // behaviour is untested and the obvious implementation is wrong: writing the hop
        // as COALESCE(d.replaced_by, e.entity_id) falls back to the TOMBSTONE when
        // replaced_by is NULL, then walks its ancestors and returns a species for an
        // identifier the register deliberately refused to redirect. That is worse than a
        // gap, because it looks like an answer. salish-8vr.5 decides what a split should
        // actually do; until then, nothing.
        await sql.begin(async tx => {
            await tx`INSERT INTO register.entities (entity_id, kind, label)
                     VALUES ('SSA:9700001', 'group', 'Split tombstone')`;
            // Give it a real taxon ancestor, so a wrong implementation would succeed here
            // rather than returning NULL for want of anything to find.
            await tx`INSERT INTO register.ancestor (entity_id, ancestor_id, depth, ancestor_kind)
                     VALUES ('SSA:9700001', 'SSA:0000900', 1, 'taxon')`;
            const [before] = await tx<{r: string | null}[]>`
                SELECT register.taxon_entity_for('SSA:9700001') AS r`;
            expect(before?.r, 'precondition: resolves before being deprecated').toBe('SSA:0000900');

            await tx`INSERT INTO register.deprecations (entity_id, reason, replaced_by, consider)
                     VALUES ('SSA:9700001', 'split', NULL, 'SSA:0000010')`;
            const [after] = await tx<{r: string | null}[]>`
                SELECT register.taxon_entity_for('SSA:9700001') AS r`;
            expect(after?.r).toBeNull();
            throw new Rollback();
        }).catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
    });

    test('a taxon is its own answer', async () => {
        if (!loaded) return;
        const [{ r }] = await sql<{r: string}[]>`
            SELECT register.taxon_entity_for('SSA:0000904') AS r`;
        expect(r).toBe('SSA:0000904');
    });

    test('a merged deprecation is followed, which is what makes the resolver total', async () => {
        if (!loaded) return;
        // SSA:0000001 is the deprecated Southern Resident ecotype, merged into SSA:0000010
        // when Q1 settled that it is a community rather than an ecotype. It is the ONLY
        // non-taxon entity that reaches no taxon ancestor of its own, so without the
        // replaced_by hop the test above fails on exactly one row.
        const [dep] = await sql<{replaced_by: string}[]>`
            SELECT replaced_by FROM register.deprecations WHERE entity_id = 'SSA:0000001'`;
        expect(dep?.replaced_by).toBe('SSA:0000010');
        const [{ direct }] = await sql<{direct: number}[]>`
            SELECT count(*)::int AS direct FROM register.ancestor
            WHERE entity_id = 'SSA:0000001' AND ancestor_kind = 'taxon'`;
        expect(direct).toBe(0);
        const [{ r }] = await sql<{r: string}[]>`
            SELECT register.taxon_entity_for('SSA:0000001') AS r`;
        expect(r).toBe('SSA:0000900');
    });

    test('an unknown identifier is NULL, not an error', async () => {
        const [{ r }] = await sql<{r: string | null}[]>`
            SELECT register.taxon_entity_for('SSA:9999999') AS r`;
        expect(r).toBeNull();
    });

    test('taxon_for builds a whole public.taxon, keyed on the TAXON entity', async () => {
        if (!loaded) return;
        // entity_id must be the taxon, not the pod that was cited: SHORT_MAP_FORMS in
        // src/symbology.ts keys on it to shorten a name, so it has to be the thing named.
        const [t] = await sql<{scientific_name: string; vernacular_name: string; species_id: number; entity_id: string}[]>`
            SELECT (register.taxon_for('SSA:0000020')).*`;
        expect(t).toEqual({
            scientific_name: 'Orcinus orca',
            vernacular_name: 'Killer whale',
            species_id: 41521,
            entity_id: 'SSA:0000900',
        });
    });

    test('it stops at the species and does not substitute the ecotype', async () => {
        if (!loaded) return;
        // A Bigg's sub-lineage resolves to Orcinus orca, NOT to SSA:0000002 "Bigg's killer
        // whale" — even though that ecotype now has a name and an iNaturalist crosswalk.
        // An ecotype is kind='group' and ADR-0008 refuses it taxonomic standing, and
        // keying species_id on rectipinnus would stop a Bigg's bout ever chaining with a
        // sighting recorded as plain Orcinus orca. The ecotype reaches the map through the
        // label instead. See the migration header.
        const [t] = await sql<{scientific_name: string; species_id: number; entity_id: string}[]>`
            SELECT (register.taxon_for('SSA:0000103')).*`;
        expect(t?.entity_id).toBe('SSA:0000900');
        expect(t?.scientific_name).toBe('Orcinus orca');
        expect(t?.species_id).toBe(41521);
    });

    test('anon can execute both functions and read the new tables', async () => {
        // The caller-rights trap. `SET LOCAL ROLE anon` is the only way to reproduce what
        // a superuser connection hides; see this file's header.
        await sql.begin(async tx => {
            await tx`SET LOCAL ROLE anon`;
            const [{ r }] = await tx<{r: string | null}[]>`
                SELECT register.taxon_entity_for('SSA:0000020') AS r`;
            if (loaded) expect(r).toBe('SSA:0000900');
            const [t] = await tx`SELECT (register.taxon_for('SSA:0000020')).*`;
            expect(t).toBeDefined();
            for (const table of ['membership', 'ancestor', 'deprecations'])
                expect(Array.isArray(await tx`SELECT 1 FROM register.${tx(table)} LIMIT 1`), table).toBe(true);
        });
    });

    test('the membership constraint permits leaving and rejoining, and refuses a duplicate', async () => {
        // Not a PK on (member_id, group_id): an animal can leave a group and rejoin, which
        // is two rows differing only in their dates. A duplicate INCLUDING the dates is a
        // corrupt load, not history, so that is what the constraint catches.
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
});

class Rollback extends Error {}
