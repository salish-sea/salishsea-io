/**
 * What `register.inaturalist_taxon_name` will and will not resolve through
 * (decision 033 as amended, migration 20260920220000).
 *
 * The view's filter is a DENY-LIST of widening predicates. That is a rule which
 * degrades silently in both directions: admitting a broadMatch puts a wider claim
 * on the map than the record supports, and refusing a coextensive closeMatch drops
 * 5,664 occurrences back to iNaturalist's vocabulary with no error anywhere. Neither
 * shows up as a failure — only as a wrong or missing label on a pin.
 *
 * Seeds its own entities rather than reading whichever edition happens to be loaded,
 * so the assertions are about the VIEW's rule and not about the register's current
 * contents. Everything runs inside a rolled-back transaction.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';

const DSN = process.env['SUPABASE_DB_URL'];

// Well outside anything the register mints, so a seeded row can never collide with
// a real one if this ever runs against a loaded database.
const SEED = {
    exact: { entity: 'SSA:9900001', taxon: 990001, label: 'Exactly this', name: 'Exact animal' },
    close: { entity: 'SSA:9900002', taxon: 990002, label: 'Coextensively this', name: 'Close animal' },
    broad: { entity: 'SSA:9900003', taxon: 990003, label: 'A wider thing', name: 'Broad animal' },
    narrow: { entity: 'SSA:9900004', taxon: 990004, label: 'A narrower thing', name: 'Narrow animal' },
    related: { entity: 'SSA:9900005', taxon: 990005, label: 'Merely related', name: 'Related animal' },
    invented: { entity: 'SSA:9900006', taxon: 990006, label: 'Unknown predicate', name: 'Invented animal' },
};

describe.skipIf(!DSN)('register crosswalk predicates (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN as string, {prepare: false, max: 1}); });
    afterAll(async () => { await sql.end(); });

    /** Seed the six entities, run `body`, roll everything back. */
    const withSeed = async (body: (tx: Sql) => Promise<void>) => {
        await sql.begin(async tx => {
            const predicates: Record<keyof typeof SEED, string> = {
                exact: 'skos:exactMatch',
                close: 'skos:closeMatch',
                broad: 'skos:broadMatch',
                narrow: 'skos:narrowMatch',
                related: 'skos:relatedMatch',
                invented: 'skos:someMatchInventedLater',
            };
            for (const [key, s] of Object.entries(SEED) as [keyof typeof SEED, typeof SEED.exact][]) {
                await tx`INSERT INTO register.entities (entity_id, kind, label) VALUES (${s.entity}, 'taxon', ${s.label})`;
                await tx`INSERT INTO register.names (entity_id, name, type, language) VALUES (${s.entity}, ${s.name}, 'common', 'en')`;
                await tx`INSERT INTO register.mappings (subject_id, predicate_id, object_id)
                         VALUES (${s.entity}, ${predicates[key]}, ${'inaturalist.taxon:' + s.taxon})`;
            }
            await body(tx);
            throw new Rollback();
        }).catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
    };

    test('exactMatch and closeMatch resolve; broad, narrow, related and unknown predicates do not', async () => {
        await withSeed(async tx => {
            const rows = await tx<{inat_taxon_id: number; common_name: string}[]>`
                SELECT inat_taxon_id, common_name FROM register.inaturalist_taxon_name
                WHERE inat_taxon_id BETWEEN 990001 AND 990006 ORDER BY inat_taxon_id`;
            expect(rows).toEqual([
                { inat_taxon_id: SEED.exact.taxon, common_name: SEED.exact.name },
                { inat_taxon_id: SEED.close.taxon, common_name: SEED.close.name },
            ]);
        });
    });

    test('an unrecognised predicate fails CLOSED, which is the point of a deny-list', async () => {
        // Stated separately from the case above because it is the property that
        // distinguishes this filter from `predicate_id NOT IN (...the bad ones)`.
        // A predicate the register invents after this migration must be adjudicated
        // here before it can reach a map pin; the default is silence, not trust.
        await withSeed(async tx => {
            const [{ n }] = await tx<{n: number}[]>`
                SELECT count(*)::int AS n FROM register.inaturalist_taxon_name
                WHERE inat_taxon_id = ${SEED.invented.taxon}`;
            expect(n).toBe(0);
        });
    });

    test('a malformed edition yields one row per taxon, and the exactMatch entity is the one kept', async () => {
        // The DISTINCT ON is load-bearing: public.occurrences LEFT JOINs this view, so a
        // second row for one taxon DOUBLES every occurrence of that animal on the map.
        // Admitting a second predicate widened the space in which that can happen.
        //
        // Two entities claiming one taxon is an upstream error that animals bin/validate.py
        // is supposed to reject (see the test below). This asserts what the view does when
        // one slips through anyway — better a stable map than a duplicated one — and it is
        // the ONLY case where the exactMatch tie-break is observable. With a single entity
        // holding both predicates the two candidate rows are identical, so the ordering
        // decides nothing; that is why this seeds two entities rather than two mappings.
        await sql.begin(async tx => {
            await tx`INSERT INTO register.entities (entity_id, kind, label) VALUES
                     ('SSA:9900007', 'taxon', 'The exact one'), ('SSA:9900008', 'taxon', 'The close one')`;
            await tx`INSERT INTO register.names (entity_id, name, type, language) VALUES
                     ('SSA:9900007', 'Exact winner', 'common', 'en'), ('SSA:9900008', 'Close loser', 'common', 'en')`;
            // Inserted close-first so a view that merely preserved insertion order would fail.
            await tx`INSERT INTO register.mappings (subject_id, predicate_id, object_id) VALUES
                     ('SSA:9900008', 'skos:closeMatch', 'inaturalist.taxon:990007'),
                     ('SSA:9900007', 'skos:exactMatch', 'inaturalist.taxon:990007')`;
            const rows = await tx<{entity_id: string; common_name: string}[]>`
                SELECT entity_id, common_name FROM register.inaturalist_taxon_name WHERE inat_taxon_id = 990007`;
            expect(rows).toEqual([{ entity_id: 'SSA:9900007', common_name: 'Exact winner' }]);
            throw new Rollback();
        }).catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
    });

    test('no iNaturalist taxon in the loaded edition is claimed by two entities', async () => {
        // The duplication hazard above is closed UPSTREAM — animals bin/validate.py checks
        // uniqueness across exactMatch and closeMatch together — not by the view, which can
        // only pick a winner. This asserts the upstream guarantee actually holds in the
        // edition we loaded, so a bad edition fails here rather than doubling pins.
        // Vacuous on an empty register, which is the honest outcome: nothing is wrong yet.
        const dupes = await sql<{inat_taxon_id: number}[]>`
            SELECT split_part(object_id, ':', 2)::integer AS inat_taxon_id
            FROM register.mappings
            WHERE object_id ~ '^inaturalist\.taxon:[0-9]{1,9}$'
              AND predicate_id IN ('skos:exactMatch', 'skos:closeMatch')
            GROUP BY 1 HAVING count(DISTINCT subject_id) > 1`;
        expect(dupes).toEqual([]);
    });

    test('a name that is not type=common is never displayed, whatever the predicate', async () => {
        // animals ADR-0011: a `hidden` name is evidence a string is in use, not one the
        // register offers. `preferred` is a canonical designation and is often notation
        // rather than English ('J17s'). Admitting closeMatch must not have widened this.
        await sql.begin(async tx => {
            await tx`INSERT INTO register.entities (entity_id, kind, label) VALUES ('SSA:9900009', 'taxon', 'Hidden only')`;
            await tx`INSERT INTO register.names (entity_id, name, type, language)
                     VALUES ('SSA:9900009', 'do not show me', 'hidden', 'en'),
                            ('SSA:9900009', 'J17s', 'preferred', 'en')`;
            await tx`INSERT INTO register.mappings (subject_id, predicate_id, object_id)
                     VALUES ('SSA:9900009', 'skos:closeMatch', 'inaturalist.taxon:990009')`;
            const rows = await tx`SELECT 1 FROM register.inaturalist_taxon_name WHERE inat_taxon_id = 990009`;
            expect(rows).toHaveLength(0);
            throw new Rollback();
        }).catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
    });
});

class Rollback extends Error {}
