/**
 * Integration suite for READ-TIME resolution of a retired taxon (salish-4hq, decision 032).
 *
 * The stored taxon id records what was claimed — by upstream on a mirror row, by a
 * contributor on a native one — and is never rewritten. `public.occurrences` and
 * `dwc.taxa_classification` hop through `inaturalist.taxa.current_taxon_id` when they read
 * it, so a record keeps naming the taxon it was filed under while showing the taxon that
 * taxon has become.
 *
 * These tests write the mirror directly (the fixture IS a retirement, which no ingest run
 * would produce on demand) and read the views, gated on SUPABASE_DB_URL like the rest of
 * the DB-backed suite. Reserved id band 2_000_001_000..2_000_001_999 — distinct from
 * persist.test.ts's band so the two can run in either order.
 *
 * The vehicle is an iNaturalist observation. It was a Maplify sighting until decision 049
 * keyed those on a register entity; the iNaturalist mirror is the table that still stores
 * an upstream taxon id, which is the thing 032 protects.
 */

import { describe, test, expect, beforeAll, afterAll, afterEach } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';

const DSN = process.env['SUPABASE_DB_URL'];

// The shape every test starts from: a genus with two species under it, one retired in
// favour of the other.
const GENUS = 2000001001;
const RETIRED = 2000001002;
const REPLACEMENT = 2000001003;
const SIGHTING = 900001001;
const OCCURRENCE = 'inaturalist:' + SIGHTING;

describe.skipIf(!DSN)('a retired taxon resolves on read (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN!, { max: 1 }); });
    afterAll(async () => { await sql?.end(); });

    afterEach(async () => {
        await sql`delete from inaturalist.observations where id >= 900001000 and id < 900002000`;
        // current_taxon_id/parent_id reference each other; clear the links before the rows.
        await sql`update inaturalist.taxa set current_taxon_id = null, parent_id = null
                    where id >= 2000001000 and id < 2000002000`;
        await sql`delete from inaturalist.taxa where id >= 2000001000 and id < 2000002000`;
    });

    /** Write the mirror as it looks after iNaturalist retires `RETIRED`. */
    async function seedRetirement(): Promise<void> {
        await sql`
            insert into inaturalist.taxa (id, parent_id, scientific_name, vernacular_name, rank)
            values (${GENUS}, null, 'Testessa', 'Test genus', 'genus'),
                   (${REPLACEMENT}, ${GENUS}, 'Testessa renamed', 'Renamed Whale', 'species'),
                   (${RETIRED}, ${GENUS}, 'Testessa obsoleta', 'Obsolete Whale', 'species')`;
        await sql`
            update inaturalist.taxa set is_active = false, current_taxon_id = ${REPLACEMENT}
             where id = ${RETIRED}`;
    }

    /** One iNaturalist observation filed under `taxonId`, surfaced as an occurrence. */
    async function seedSighting(taxonId: number): Promise<void> {
        await sql`
            insert into inaturalist.observations (
                id, location, observed_at, uri, taxon_id, fetched_at, updated_at
            ) values (
                ${SIGHTING}, gis.ST_Point(-123.0, 48.5)::gis.geography, '2026-07-03 10:00:00Z',
                'https://example.test/observations/1', ${taxonId}, now(), now()
            )`;
    }

    test('the occurrence shows the live taxon, not the one it was filed under', async () => {
        await seedRetirement();
        await seedSighting(RETIRED);

        // The `taxon` composite comes back as a raw tuple string, so read its fields.
        const [o] = await sql`
            select (taxon).scientific_name, (taxon).species_id
              from public.occurrences where id = ${OCCURRENCE}`;

        expect(o?.['scientific_name']).toBe('Testessa renamed');
        // species_id chains sightings of one species into a track. Left unresolved, a
        // retirement splits one animal into two tracks — and two colours on the map.
        expect(Number(o?.['species_id'])).toBe(REPLACEMENT);
    });

    test('the stored id still records what was claimed', async () => {
        await seedRetirement();
        await seedSighting(RETIRED);

        const [s] = await sql`select taxon_id from inaturalist.observations where id = ${SIGHTING}`;
        expect(Number(s?.['taxon_id'])).toBe(RETIRED);
    });

    test('an active taxon is unaffected', async () => {
        await seedRetirement();
        await seedSighting(REPLACEMENT);

        const [o] = await sql`
            select (taxon).scientific_name from public.occurrences where id = ${OCCURRENCE}`;
        expect(o?.['scientific_name']).toBe('Testessa renamed');
    });

    // A retirement with no replacement is common: 7 of the 9 in the mirror name none.
    // Resolution must leave those alone rather than drop the record.
    test('a retirement naming no replacement still shows its own name', async () => {
        await seedRetirement();
        await sql`update inaturalist.taxa set current_taxon_id = null where id = ${RETIRED}`;
        await seedSighting(RETIRED);

        const [o] = await sql`
            select (taxon).scientific_name from public.occurrences where id = ${OCCURRENCE}`;
        expect(o?.['scientific_name']).toBe('Testessa obsoleta');
    });

    // species_id reports a subspecies' PARENT, read straight off the row, so resolving
    // only the leaf would leave a live subspecies chaining onto a dead species id.
    test("a live subspecies under a retired species chains onto the live species", async () => {
        await seedRetirement();
        const subspecies = 2000001005;
        await sql`
            insert into inaturalist.taxa (id, parent_id, scientific_name, vernacular_name, rank)
            values (${subspecies}, ${RETIRED}, 'Testessa obsoleta minor', null, 'subspecies')`;
        await seedSighting(subspecies);

        const [o] = await sql`
            select (taxon).species_id from public.occurrences where id = ${OCCURRENCE}`;
        expect(Number(o?.['species_id'])).toBe(REPLACEMENT);
    });

    // The regression lock for a production incident on 2026-08-29. A view checks the
    // objects it references against its OWNER, but a FUNCTION BODY is checked against the
    // CALLER, and anon has no USAGE on the inaturalist schema. Teaching species_id to read
    // the taxa table therefore broke every anonymous read of the view, which testing as
    // superuser cannot show. SET LOCAL ROLE keeps the role change inside the transaction.
    test('anon can still read the view (the role the site uses)', async () => {
        await seedRetirement();
        await seedSighting(RETIRED);

        const [o] = await sql.begin(async (tx) => {
            await tx`set local role anon`;
            return tx`select (taxon).species_id from public.occurrences
                       where id = ${OCCURRENCE}`;
        }) as unknown as [{ species_id: number }];

        expect(Number(o?.species_id)).toBe(REPLACEMENT);
    });

    test('the DwC classification answers for the id as recorded, with live names', async () => {
        await seedRetirement();

        const [c] = await sql`
            select taxon_id, scientific_name, genus from dwc.taxa_classification
             where taxon_id = ${RETIRED}`;
        // Keyed by the id the record holds, so a join on the stored id still finds it…
        expect(Number(c?.['taxon_id'])).toBe(RETIRED);
        // …but every name it reports is the live taxon's.
        expect(c?.['scientific_name']).toBe('Testessa renamed');
    });

    // parent_id is the one link scripts/backfill/inat-taxa-status.ts refuses to repoint,
    // so a retired ancestor can ONLY be resolved here.
    test('an ancestor retired above a live taxon resolves too', async () => {
        await seedRetirement();
        const liveGenus = 2000001004;
        await sql`
            insert into inaturalist.taxa (id, parent_id, scientific_name, vernacular_name, rank)
            values (${liveGenus}, null, 'Testessa nova', null, 'genus')`;
        await sql`update inaturalist.taxa set is_active = false, current_taxon_id = ${liveGenus}
                   where id = ${GENUS}`;

        const [c] = await sql`
            select genus from dwc.taxa_classification where taxon_id = ${REPLACEMENT}`;
        expect(c?.['genus']).toBe('Testessa nova');
    });
});
