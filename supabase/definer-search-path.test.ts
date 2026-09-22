/**
 * Every SECURITY DEFINER function of ours runs with an empty search_path (bd salish-c94).
 *
 * A definer-rights function runs with its owner's privileges, so what its unqualified
 * names resolve to matters more than usual. `register.taxon_for` had
 * `register, public, pg_catalog`: naming pg_catalog explicitly, after public, lets an
 * object created in public shadow a built-in function or operator the body calls. The
 * repo's convention is `SET search_path = ''` with every name schema-qualified; this holds
 * new functions to it, because nothing else would notice a copied-in `public`.
 *
 * Extension-owned functions are excluded: PostGIS ships definer-rights functions of its
 * own (gis.st_estimatedextent) with no search_path set, and they are not ours to change.
 *
 * Read-only; gated on SUPABASE_DB_URL like the other integration tiers (decision 011).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';

const DSN = process.env['SUPABASE_DB_URL'];

/** Schemas whose functions we write. Supabase's own (auth, storage, realtime, …) are its business. */
const OUR_SCHEMAS = ['public', 'register', 'inaturalist', 'maplify', 'happywhale', 'orcasound', 'ingest', 'dwc'];

describe.skipIf(!DSN)('definer-rights functions (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN!, { max: 1 }); });
    afterAll(async () => { await sql?.end(); });

    test('every one of ours sets search_path to empty', async () => {
        // Compare the one setting, not the joined string: a function may also SET something else.
        const rows = await sql<{ fn: string; config: string | null; empty: boolean }[]>`
            SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS fn,
                   array_to_string(p.proconfig, ';') AS config,
                   COALESCE(array_position(p.proconfig, 'search_path=""') IS NOT NULL, false) AS empty
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE p.prosecdef
              AND n.nspname = ANY(${OUR_SCHEMAS})
              AND NOT EXISTS (SELECT 1 FROM pg_depend d
                              WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')`;
        // Not vacuous: register.taxon_for alone guarantees a row.
        expect(rows.length).toBeGreaterThan(0);
        const offenders = rows.filter(r => !r.empty).map(r => `${r.fn}: ${r.config ?? 'unset'}`);
        expect(offenders).toEqual([]);
    });
});
