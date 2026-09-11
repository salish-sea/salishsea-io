/**
 * What a client may READ in `public` and `dwc`, pinned (bd salish-pee).
 *
 * The gap this closes was invisible precisely because production looked right.
 * Production's SELECT grants had been applied by hand, and every later
 * `CREATE OR REPLACE VIEW` preserved them, so nothing ever disturbed prod and
 * nothing ever reproduced them elsewhere: a database built from the migrations
 * alone served no data — "permission denied for view occurrences" — and nobody
 * knew until someone tried (salish-0ew, migration 20260730120000). Nothing then
 * stopped it happening again the next time a grant was applied out of band.
 *
 * So: the set below is what production granted on 2026-09-10, taken with the
 * query in `effectiveReads`, and this test asserts a fresh reset from
 * migrations produces exactly it. A migration that creates a readable relation
 * updates this list in the same PR — a table's permissions are something a
 * migration says, not something the schema hands out (README convention). A
 * grant applied to prod by hand now shows up as this test failing the next time
 * someone diffs prod against it, rather than as a mystery a year later.
 *
 * It runs in build.yml against the CI database, and build.yml is also the
 * deploy gate, so a migration that drops a grant blocks production rather than
 * a PR.
 *
 * Effective privileges, as `public-grants.test.ts` argues: `has_table_privilege`
 * and `has_column_privilege` answer the way Postgres does at query time, so a
 * grant to PUBLIC or one inherited through role membership counts, and the
 * catalogue views' blind spots do not apply.
 *
 * Both roles read the same things today. Kept as two assertions so the day they
 * diverge on purpose, the fixture says so rather than a `flatMap`.
 *
 * To re-take the fixture from production:
 *
 *   npx supabase db query --linked "<the effectiveReads query>" | jq -r '.rows[]'
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';

const DSN = process.env['SUPABASE_DB_URL'];

/** Relations a client reads in full. Production, 2026-09-10. */
const READABLE = [
    'dwc.datasets',
    'dwc.multimedia',
    'dwc.taxa_classification',
    'public.collections',
    'public.contributors',
    'public.designations',
    'public.ecotype_occurrences',
    'public.group_memberships',
    'public.group_occurrences',
    'public.haulout_occurrences',
    'public.haulouts',
    'public.identifications',
    'public.individual_occurrences',
    'public.individuals',
    'public.observation_photos',
    'public.observations',
    'public.occurrence_identifications',
    'public.occurrence_unresolved_codes',
    'public.occurrences',
    'public.organizations',
    'public.parties',
    'public.providers',
    'public.social_groups',
    'public.user_contributor',
];

/**
 * Relations a client reads only some columns of. `nicknames.story` is a
 * verbatim Bigg's-sheet cell, withheld under rights-policy D-21 (decision 015).
 */
const PARTIALLY_READABLE: Record<string, string[]> = {
    'public.nicknames': ['id', 'individual_id', 'name', 'named_year', 'namer_id', 'social_group_id', 'status', 'theme'],
};

describe.skipIf(!DSN)('public and dwc read grants (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN as string, {prepare: false, max: 1}); });
    afterAll(async () => { await sql.end(); });

    /**
     * Every relation the role can read at least one column of: the whole
     * relation, or the readable columns when not.
     */
    const effectiveReads = async (role: string) => {
        const rows = await sql<{rel: string; full_select: boolean; cols: string[] | null}[]>`
            SELECT n.nspname || '.' || c.relname AS rel,
                   has_table_privilege(${role}, c.oid, 'SELECT') AS full_select,
                   (SELECT array_agg(a.attname ORDER BY a.attname COLLATE "C")
                      FROM pg_attribute a
                     WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
                       AND has_column_privilege(${role}, c.oid, a.attnum, 'SELECT')) AS cols
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname IN ('public', 'dwc') AND c.relkind IN ('r', 'p', 'v', 'm')
            ORDER BY (n.nspname || '.' || c.relname) COLLATE "C"`;
        const full: string[] = [];
        const partial: Record<string, string[]> = {};
        for (const row of rows) {
            if (row.cols === null) continue;
            if (row.full_select) full.push(row.rel);
            else partial[row.rel] = row.cols;
        }
        return {full, partial};
    };

    for (const role of ['anon', 'authenticated']) {
        test(`${role} reads exactly the pinned relations`, async () => {
            const reads = await effectiveReads(role);
            // Byte order on both sides: prod's and CI's default collations need
            // not agree on where an underscore sorts.
            expect(reads.full).toEqual([...READABLE].sort());
            expect(reads.partial).toEqual(
                Object.fromEntries(Object.entries(PARTIALLY_READABLE).map(([rel, cols]) => [rel, [...cols].sort()])));
        });
    }
});
