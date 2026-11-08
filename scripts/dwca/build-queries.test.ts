/**
 * Static guard for build.ts's relation references.
 *
 * `build.ts` reads its relations through an `archive` catalog the caller supplies
 * (the read-path build, from its own derivation, derive/dwc.sql), so EVERY relation
 * referenced in a DuckDB query MUST be `archive`-qualified (e.g.
 * `archive.dwc.occurrences`, `archive.maplify.sightings`). A bare
 * `FROM maplify.sightings` resolves against the connection's default catalog, the
 * snapshot, which in production has no such schema, and fails with
 * `Catalog Error: schema "maplify" does not exist`.
 *
 * `build.test.ts`, which writes the archive from the test fixture, can't catch this:
 * the fixture's snapshot does hold a `maplify.sightings`, the Postgres-shaped source
 * table its mirrors are written from, so a bare reference quietly reads that instead
 * (checked 2026-11-07). This test greps the build.ts source instead.
 *
 * Context: Phase 12 shipped a Step 15.5 associated-parties query with bare
 * `maplify.sightings` / `public.*` refs; the nightly failed with the catalog
 * error (run 27916122893) and was fixed in `aad63dd`. This guard prevents
 * recurrence of that class.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

// The schemas build.ts reads, reachable only through the `archive` catalog.
const PG_SCHEMAS = ['maplify', 'public', 'dwc', 'inaturalist', 'happywhale', 'gis'] as const;

describe('build.ts query references are archive-qualified', () => {
    const src = readFileSync(path.resolve(__dirname, 'build.ts'), 'utf8');

    test('no bare FROM/JOIN onto one of those schemas (must be archive.<schema>.<table>)', () => {
        // Match `FROM <schema>.` or `JOIN <schema>.` where <schema> is a real
        // Postgres schema. A correctly-qualified ref reads `FROM archive.<schema>.`,
        // so the token immediately after FROM/JOIN is `archive`, never the schema —
        // any direct hit here is therefore an unqualified (buggy) reference.
        const bareRef = new RegExp(
            `\\b(?:FROM|JOIN)\\s+(${PG_SCHEMAS.join('|')})\\.`,
            'gi',
        );
        const offenders = [...src.matchAll(bareRef)].map((m) => m[0]);
        expect(
            offenders,
            `build.ts has unqualified refs (must be archive.-prefixed): ${offenders.join(', ')}`,
        ).toEqual([]);
    });

    test('every archive.<x> reference targets a known schema (typo guard)', () => {
        const qualified = [...src.matchAll(/\barchive\.([a-z_]+)\./gi)].map((m) => m[1]!.toLowerCase());
        const unknown = qualified.filter((s) => !(PG_SCHEMAS as readonly string[]).includes(s));
        expect(unknown, `archive-qualified refs to unknown schema(s): ${unknown.join(', ')}`).toEqual([]);
    });
});
