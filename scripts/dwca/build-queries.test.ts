/**
 * Static guard for build.ts Postgres query references.
 *
 * `build.ts` reads Postgres through a DuckDB `ATTACH '<dsn>' AS pgdb` alias
 * (build.ts step 5), so EVERY Postgres relation referenced in a DuckDB query
 * MUST be `pgdb`-qualified (e.g. `pgdb.dwc.occurrences`, `pgdb.maplify.sightings`).
 * A bare `FROM maplify.sightings` resolves against DuckDB's own catalog and
 * fails at runtime with `Catalog Error: schema "maplify" does not exist` — only
 * surfacing in the nightly build against the live DB, because `build.test.ts`
 * is gated on `SUPABASE_DB_URL` and skips on a fresh checkout / in CI.
 *
 * This test needs NO database: it greps the build.ts source so the regression
 * is caught on every checkout. Companion to the DB-gated `build.test.ts`.
 *
 * Context: Phase 12 shipped a Step 15.5 associated-parties query with bare
 * `maplify.sightings` / `public.*` refs; the nightly failed with the catalog
 * error (run 27916122893) and was fixed in `aad63dd`. This guard prevents
 * recurrence of that class.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

// Postgres schemas reachable only through the `pgdb` ATTACH alias inside build.ts.
const PG_SCHEMAS = ['maplify', 'public', 'dwc', 'inaturalist', 'happywhale', 'gis'] as const;

describe('build.ts Postgres query references are pgdb-qualified', () => {
    const src = readFileSync(path.resolve(__dirname, 'build.ts'), 'utf8');

    test('no bare FROM/JOIN onto a Postgres schema (must be pgdb.<schema>.<table>)', () => {
        // Match `FROM <schema>.` or `JOIN <schema>.` where <schema> is a real
        // Postgres schema. A correctly-qualified ref reads `FROM pgdb.<schema>.`,
        // so the token immediately after FROM/JOIN is `pgdb`, never the schema —
        // any direct hit here is therefore an unqualified (buggy) reference.
        const bareRef = new RegExp(
            `\\b(?:FROM|JOIN)\\s+(${PG_SCHEMAS.join('|')})\\.`,
            'gi',
        );
        const offenders = [...src.matchAll(bareRef)].map((m) => m[0]);
        expect(
            offenders,
            `build.ts has unqualified Postgres refs (must be pgdb.-prefixed): ${offenders.join(', ')}`,
        ).toEqual([]);
    });

    test('every pgdb.<x> reference targets a known Postgres schema (typo guard)', () => {
        const qualified = [...src.matchAll(/\bpgdb\.([a-z_]+)\./gi)].map((m) => m[1]!.toLowerCase());
        const unknown = qualified.filter((s) => !(PG_SCHEMAS as readonly string[]).includes(s));
        expect(unknown, `pgdb-qualified refs to unknown schema(s): ${unknown.join(', ')}`).toEqual([]);
    });
});
