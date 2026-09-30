/**
 * derived.occurrences is exactly what its five views compute, whoever writes (decision 055).
 *
 * The store replaced a view and two five-minute matview refreshes. Its whole promise is that
 * it never differs from the derivation: every source write refreshes the keys it touched in
 * the writer's own transaction, and reference data marks the store stale for a rebuild. A
 * trigger missing from one table, or a key column named wrong, would not fail loudly — the
 * map would just keep showing yesterday's comment — so the invariant is asserted directly:
 * after each kind of write, the stored rows and the views' rows are the same set.
 *
 * Writes the ingest makes are made as the `ingest` role, which has no privilege in `derived`,
 * because every DB test otherwise runs as postgres and would hide a missing definer
 * (bd memory test-as-the-least-privilege-role). Each test rolls back, except the last, whose
 * procedure commits by design and leaves the store as it found it.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import type { Sql, TransactionSql } from 'postgres';

const DSN = process.env['SUPABASE_DB_URL'];

// The CI seed's one register entity, its iNaturalist taxon, and its signed-in contributor.
const ORCA = 'SSA:0000900';
const ORCA_TAXON = 41521;
const CI_USER = '00000000-0000-0000-0000-000000000001';

// Ids in the band persist.test.ts reserves for test rows.
const SIGHTING = 900901;
const INAT = 900902;
const BOUT = 'bout_TESTstore';
const NATIVE = '00000000-0000-4000-8000-000000900903';

const ROLLBACK = Symbol('rollback');

async function rolledBack<T>(sql: Sql, body: (tx: TransactionSql) => Promise<T>): Promise<T> {
    let result: T | undefined;
    await sql.begin(async (tx) => {
        result = await body(tx);
        throw ROLLBACK;
    }).catch((err: unknown) => {
        if (err !== ROLLBACK) throw err;
    });
    return result as T;
}

/**
 * Occurrence ids where the store and the derivation disagree, either way. Compared as jsonb so
 * composite and array columns compare by value, the same way the refresh's guard does.
 */
async function drift(tx: TransactionSql): Promise<string[]> {
    const rows = await tx<{ id: string }[]>`
        WITH derivation AS (
            SELECT to_jsonb(v) - 'source_key' || jsonb_build_object('source', 'maplify', 'source_key', v.source_key::text) AS j FROM derived.maplify_occurrences v
            UNION ALL SELECT to_jsonb(v) - 'source_key' || jsonb_build_object('source', 'inaturalist', 'source_key', v.source_key::text) FROM derived.inaturalist_occurrences v
            UNION ALL SELECT to_jsonb(v) - 'source_key' || jsonb_build_object('source', 'happywhale', 'source_key', v.source_key::text) FROM derived.happywhale_occurrences v
            UNION ALL SELECT to_jsonb(v) - 'source_key' || jsonb_build_object('source', 'native', 'source_key', v.source_key::text) FROM derived.native_occurrences v
            UNION ALL SELECT to_jsonb(v) - 'source_key' || jsonb_build_object('source', 'orcasound', 'source_key', v.source_key::text) FROM derived.orcasound_occurrences v
        ), stored AS (SELECT to_jsonb(o) AS j FROM derived.occurrences o)
        SELECT j->>'id' AS id FROM (SELECT j FROM derivation EXCEPT SELECT j FROM stored) missing
        UNION
        SELECT j->>'id' FROM (SELECT j FROM stored EXCEPT SELECT j FROM derivation) extra
        UNION
        SELECT c.occurrence_id FROM (
            SELECT * FROM derived.identifier_candidates
            EXCEPT SELECT * FROM derived.occurrence_identifier_candidates) c
        UNION
        SELECT c.occurrence_id FROM (
            SELECT * FROM derived.occurrence_identifier_candidates
            EXCEPT SELECT * FROM derived.identifier_candidates) c`;
    return rows.map((r) => r.id);
}

/** Write as the ingest role; `derived` is closed to it, so read back after `asPostgres`. */
const asIngest = async (tx: TransactionSql) => {
    // postgres created `ingest`, so it may grant itself membership; the rollback undoes it.
    await tx`GRANT ingest TO postgres`;
    await tx`SET LOCAL ROLE ingest`;
};
const asPostgres = (tx: TransactionSql) => tx`RESET ROLE`;

const insertSighting = (tx: TransactionSql, comments: string) => tx`
    INSERT INTO maplify.sightings (id, project_id, trip_id, scientific_name, entity_id, location, number_sighted,
                                   created_at, comments, in_ocean, moderated, trusted, is_test, source)
    VALUES (${SIGHTING}, 7, 1, 'Orcinus orca', ${ORCA}, gis.ST_Point(-123.1, 48.4)::gis.geography, 3,
            '2026-09-01 10:00:00', ${comments}, true, 1, true, false, 'test')`;

const storedIds = async (tx: TransactionSql) =>
    (await tx<{ id: string }[]>`SELECT id FROM derived.occurrences ORDER BY id`).map((r) => r.id);

describe.skipIf(!DSN)('derived.occurrences equals its derivation (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN as string, { prepare: false, max: 1 }); });
    afterAll(async () => { await sql.end(); });

    test('the store starts equal to its derivation', async () => {
        expect(await rolledBack(sql, drift)).toEqual([]);
    });

    test('inserts, updates and deletes by the ingest, to every ingested table, keep it equal', async () => {
        const result = await rolledBack(sql, async (tx) => {
            await asIngest(tx);
            await insertSighting(tx, 'Orcas heading north');
            await tx`INSERT INTO inaturalist.observations (id, description, location, observed_at, uri, taxon_id, fetched_at, updated_at)
                     VALUES (${INAT}, 'a whale', gis.ST_Point(-123.2, 48.5)::gis.geography, '2026-09-01T11:00:00Z',
                             'https://example.test/observations/900902', ${ORCA_TAXON}, now(), now())`;
            await tx`INSERT INTO inaturalist.observation_photos (id, observation_id, seq, attribution, hidden, license, original_dimensions, url)
                     VALUES (9009021, ${INAT}, 1, '(c) someone', false, 'cc-by', ROW(10, 10), 'https://example.test/1.jpg'),
                            (9009022, ${INAT}, 2, '(c) someone', false, 'cc-by', ROW(10, 10), 'https://example.test/2.jpg')`;
            await tx`INSERT INTO public.acoustic_bouts (id, feed_id, feed_name, location, started_at, title, provider_id, collection_id)
                     VALUES (${BOUT}, 'feed_1', 'Test Lab', gis.ST_Point(-123.17, 48.56)::gis.geography, '2026-09-01T12:00:00Z',
                             'calls', (SELECT id FROM public.providers WHERE slug = 'orcasound'),
                             (SELECT id FROM public.collections WHERE slug = 'orcasound'))`;
            await tx`INSERT INTO public.acoustic_bout_entities (bout_id, entity_id, certainty) VALUES (${BOUT}, ${ORCA}, 'possible')`;
            await asPostgres(tx);
            const afterInserts = { ids: await storedIds(tx), drift: await drift(tx) };

            await asIngest(tx);
            await tx`UPDATE maplify.sightings SET comments = 'Orcas heading south' WHERE id = ${SIGHTING}`;
            // Each write alone, so no later write to the same occurrence can mask a missing trigger.
            await tx`UPDATE inaturalist.observation_photos SET hidden = true WHERE id = 9009021`;
            await tx`UPDATE public.acoustic_bout_entities SET certainty = 'certain' WHERE bout_id = ${BOUT}`;
            await asPostgres(tx);
            const [after] = await tx<{ direction: string; photos: number; certainty: string }[]>`
                SELECT (SELECT direction::text FROM public.occurrences WHERE id = ${'maplify:' + SIGHTING}) AS direction,
                       (SELECT cardinality(photos) FROM public.occurrences WHERE id = ${'inaturalist:' + INAT}) AS photos,
                       (SELECT certainty::text FROM public.occurrences WHERE id = ${`orcasound:${BOUT}:${ORCA}`}) AS certainty`;
            const afterUpdates = { ...after!, drift: await drift(tx) };

            await asIngest(tx);
            await tx`DELETE FROM inaturalist.observation_photos WHERE id = 9009022`;
            await asPostgres(tx);
            const [{ photos: afterPhotoDelete }] = await tx<{ photos: number }[]>`
                SELECT cardinality(photos) AS photos FROM public.occurrences WHERE id = ${'inaturalist:' + INAT}`;

            await asIngest(tx);
            await tx`DELETE FROM maplify.sightings WHERE id = ${SIGHTING}`;
            await tx`DELETE FROM inaturalist.observation_photos WHERE observation_id = ${INAT}`;
            await tx`DELETE FROM inaturalist.observations WHERE id = ${INAT}`;
            await tx`DELETE FROM public.acoustic_bouts WHERE id = ${BOUT}`;
            await asPostgres(tx);
            const afterDeletes = { ids: await storedIds(tx), drift: await drift(tx) };
            return { afterInserts, afterUpdates, afterPhotoDelete, afterDeletes };
        });

        expect(result.afterInserts.ids).toEqual(expect.arrayContaining([
            `maplify:${SIGHTING}`, `inaturalist:${INAT}`, `orcasound:${BOUT}:${ORCA}`,
        ]));
        expect(result.afterInserts.drift).toEqual([]);
        expect(result.afterUpdates).toEqual({ direction: 'south', photos: 1, certainty: 'certain', drift: [] });
        expect(result.afterPhotoDelete).toBe(0);
        expect(result.afterDeletes.ids).not.toEqual(expect.arrayContaining([`maplify:${SIGHTING}`]));
        expect(result.afterDeletes.ids).not.toEqual(expect.arrayContaining([`inaturalist:${INAT}`]));
        expect(result.afterDeletes.ids).not.toEqual(expect.arrayContaining([`orcasound:${BOUT}:${ORCA}`]));
        expect(result.afterDeletes.drift).toEqual([]);
    });

    test('a sighting saved here, its photo, and its contributor\'s new name keep it equal', async () => {
        const result = await rolledBack(sql, async (tx) => {
            const [c] = await tx<{ id: number }[]>`SELECT contributor_id AS id FROM public.user_contributor WHERE user_uuid = ${CI_USER}`;
            await tx`INSERT INTO public.observations (id, observed_at, subject_location, body, created_at, updated_at, contributor_id, user_uuid, entity_id)
                     VALUES (${NATIVE}, '2026-09-01T13:00:00Z', gis.ST_Point(-123.3, 48.6)::gis.geography, 'one orca',
                             now(), now(), ${c!.id}, ${CI_USER}, ${ORCA})`;
            await tx`INSERT INTO public.observation_photos (observation_id, seq, license_code, href)
                     VALUES (${NATIVE}, 1, 'cc-by', 'https://example.test/n.jpg')`;
            await tx`UPDATE public.contributors SET name = 'Renamed Observer' WHERE id = ${c!.id}`;
            const [o] = await tx<{ attribution: string; photos: number }[]>`
                SELECT attribution, cardinality(photos) AS photos FROM public.occurrences WHERE id = ${NATIVE}`;
            return { ...o!, drift: await drift(tx) };
        });
        expect(result).toEqual({ attribution: 'Renamed Observer on SalishSea.io', photos: 1, drift: [] });
    });

    test('a mention in a comment is a candidate as soon as it is written, and stops being one when edited out', async () => {
        const result = await rolledBack(sql, async (tx) => {
            const [i] = await tx<{ id: number }[]>`
                INSERT INTO public.individuals (primary_designation) VALUES ('T999A') RETURNING id`;
            await tx`INSERT INTO public.designations (individual_id, code, scheme)
                     VALUES (${i!.id}, 'T999A', (enum_range(NULL::public.designation_scheme))[1])`;
            await asIngest(tx);
            await insertSighting(tx, 'T999A heading north');
            await asPostgres(tx);
            const mentioned = await tx`SELECT individual_id FROM derived.occurrence_identifier_candidates
                                       WHERE occurrence_id = ${'maplify:' + SIGHTING} AND code = 'T999A'`;
            await asIngest(tx);
            await tx`UPDATE maplify.sightings SET comments = 'heading north' WHERE id = ${SIGHTING}`;
            await asPostgres(tx);
            const edited = await tx`SELECT 1 FROM derived.occurrence_identifier_candidates
                                    WHERE occurrence_id = ${'maplify:' + SIGHTING}`;
            return { individual: i!.id, mentioned: mentioned.map((r) => r['individual_id']), edited: edited.length, drift: await drift(tx) };
        });
        expect(result.mentioned).toEqual([result.individual]);
        expect(result.edited).toBe(0);
        expect(result.drift).toEqual([]);
    });

    test('reference data marks the store stale, a no-op upsert does not, and refresh_all converges', async () => {
        const result = await rolledBack(sql, async (tx) => {
            // Only this transaction's marks: marked_at defaults to now(), which is the
            // transaction's start. Other test files commit reference-data writes while this
            // one runs (taxon-resolution's taxa), and a count of the whole table saw theirs.
            const marks = async () =>
                (await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM derived.stale_marks
                                           WHERE marked_at = now()`)[0]!.n;
            await tx`DELETE FROM derived.stale_marks`;
            // The iNaturalist ingest's taxa upsert, every tick, changing nothing.
            await tx`INSERT INTO inaturalist.taxa SELECT * FROM inaturalist.taxa WHERE id = ${ORCA_TAXON} ON CONFLICT (id) DO NOTHING`;
            const afterNoop = await marks();
            await tx`UPDATE public.providers SET name = 'Renamed Provider' WHERE slug = 'direct'`;
            const afterChange = await marks();
            const staleDrift = await drift(tx);
            await tx`SELECT derived.refresh_all()`;
            return { afterNoop, afterChange, staleDrift, drift: await drift(tx), afterRebuild: await marks() };
        });
        expect(result.afterNoop).toBe(0);
        expect(result.afterChange).toBe(1);
        // The seeded native sighting is the CI seed's 'direct' provider's: stale until the rebuild.
        expect(result.staleDrift.length).toBeGreaterThan(0);
        expect(result.drift).toEqual([]);
        expect(result.afterRebuild).toBe(0);
    });

    test('truncating a source table empties its part of the store', async () => {
        const left = await rolledBack(sql, async (tx) => {
            await tx`TRUNCATE maplify.sightings`;
            return (await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM derived.occurrences WHERE source = 'maplify'`)[0]!.n;
        });
        expect(left).toBe(0);
    });

    test('two writers refreshing one occurrence at once both land', async () => {
        // Committed, because the race is between two sessions. Removed at the end.
        await sql`INSERT INTO inaturalist.observations (id, description, location, observed_at, uri, taxon_id, fetched_at, updated_at)
                  VALUES (${INAT}, 'a whale', gis.ST_Point(-123.2, 48.5)::gis.geography, '2026-09-01T11:00:00Z',
                          'https://example.test/observations/900902', ${ORCA_TAXON}, now(), now())`;
        const first = postgres(DSN as string, { prepare: false, max: 1 });
        const second = postgres(DSN as string, { prepare: false, max: 1 });
        const photo = (tx: TransactionSql, id: number) => tx`
            INSERT INTO inaturalist.observation_photos (id, observation_id, seq, attribution, hidden, license, original_dimensions, url)
            VALUES (${id}, ${INAT}, ${id % 10}, '(c) someone', false, 'cc-by', ROW(10, 10), ${`https://example.test/${id}.jpg`})`;
        try {
            let release!: () => void;
            const held = new Promise<void>((resolve) => { release = resolve; });
            let firstWrote!: () => void;
            const wrote = new Promise<void>((resolve) => { firstWrote = resolve; });
            // The first writer inserts a photo, refreshes the occurrence, and holds its
            // transaction open until the second is waiting on it.
            const a = first.begin(async (tx) => { await photo(tx, 9009021); firstWrote(); await held; });
            await wrote;
            const b = second.begin((tx) => photo(tx, 9009022));
            // Wait until the second writer is blocked on the source's lock, then let the first commit.
            for (let i = 0; i < 100; i++) {
                const [w] = await sql<{ n: number }[]>`
                    SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`;
                if (w!.n > 0) break;
                await new Promise((r) => setTimeout(r, 20));
            }
            release();
            await Promise.all([a, b]);
            const [o] = await sql<{ photos: number }[]>`
                SELECT cardinality(photos) AS photos FROM derived.occurrences WHERE id = ${'inaturalist:' + INAT}`;
            expect(o!.photos).toBe(2);
        } finally {
            await first.end();
            await second.end();
            await sql`DELETE FROM inaturalist.observation_photos WHERE observation_id = ${INAT}`;
            await sql`DELETE FROM inaturalist.observations WHERE id = ${INAT}`;
        }
    });

    test('the five-minute job rebuilds when stale, and clears the marks it saw', async () => {
        // CALL commits between sources, so this runs outside a transaction. It changes nothing
        // the store did not already say, which the first test establishes. Other test files
        // commit real reference writes, and so marks of their own, concurrently: this looks
        // only at its own.
        const [mark] = await sql<{ id: string }[]>`
            INSERT INTO derived.stale_marks (source_table) VALUES ('test') RETURNING id::text`;
        await sql`CALL derived.rebuild_occurrences(only_if_stale => true)`;
        const left = await sql`SELECT 1 FROM derived.stale_marks WHERE id = ${mark!.id}::bigint`;
        expect(left.length).toBe(0);
        expect(await rolledBack(sql, drift)).toEqual([]);
    });
});
