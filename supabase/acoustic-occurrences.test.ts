/**
 * The Orcasound branch of public.occurrences (salish-8vr.26, migration 20260925120000,
 * decision 053).
 *
 * A bout becomes one occurrence per species its cited entities reach, carrying the cited
 * groups and individuals as identifiers; a bout citing nothing placeable is shown nowhere.
 * The test seeds its own register graph and its own bouts inside a rolled-back transaction,
 * so it runs in CI, where no register edition is loaded (see register-ancestry.test.ts on
 * why a seeded graph rather than a guarded assertion).
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import postgres from 'postgres';
import type { Sql } from 'postgres';

const DSN = process.env['SUPABASE_DB_URL'];

// Identifiers well outside anything the register mints.
const ORCA = 'SSA:9800900';   // taxon
const HUMP = 'SSA:9800901';   // taxon
const ECO = 'SSA:9800002';    // ecotype (group): walked past for the taxon, kept as an identifier
const POD = 'SSA:9800020';    // pod (group)
const SPLIT = 'SSA:9800003';  // deprecated by a split: reaches no taxon

class Rollback extends Error {}

type Row = {
    id: string; taxon_entity: string | null; scientific_name: string | null; vernacular_name: string | null;
    identifiers: string[]; observed_at: Date; observed_until: Date | null;
    lon: number; lat: number; provider_slug: string; collection: string; body: string | null; url: string;
};

describe.skipIf(!DSN)('public.occurrences: the Orcasound branch (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN as string, { prepare: false, max: 1 }); });
    afterAll(async () => { await sql.end(); });

    let rows: Row[] = [];

    beforeAll(async () => {
        await sql.begin(async (tx) => {
            await tx`INSERT INTO register.entities (entity_id, kind, rank, label) VALUES
                (${ORCA}, 'taxon', 'species', 'Testus orca'),
                (${HUMP}, 'taxon', 'species', 'Testus humpback'),
                (${ECO}, 'group', 'ecotype', 'Test Resident'),
                (${POD}, 'group', 'pod', 'J'),
                (${SPLIT}, 'group', 'pod', 'Gone')`;
            await tx`INSERT INTO register.names (entity_id, name, type, language) VALUES
                (${ORCA}, 'Test killer whale', 'common', 'en')`;
            await tx`INSERT INTO register.ancestor (entity_id, ancestor_id, depth, ancestor_kind) VALUES
                (${POD}, ${ECO}, 1, 'group'),
                (${POD}, ${ORCA}, 2, 'taxon'),
                (${ECO}, ${ORCA}, 1, 'taxon')`;
            await tx`INSERT INTO register.deprecations (entity_id, replaced_by, reason) VALUES (${SPLIT}, NULL, 'split')`;

            await tx`INSERT INTO public.acoustic_bouts (id, feed_id, feed_name, location, started_at, ended_at, title, provider_id, collection_id) VALUES
                ('bout_TESTtwo', 'feed_1', 'Test Lab', gis.ST_Point(-123.17, 48.56)::gis.geography,
                    '2026-09-01T10:00:00Z', '2026-09-01T10:30:00Z', 'SRKW and a humpback',
                    (SELECT id FROM public.providers WHERE slug = 'orcasound'),
                    (SELECT id FROM public.collections WHERE slug = 'orcasound')),
                ('bout_TESTnone', 'feed_1', 'Test Lab', gis.ST_Point(-123.17, 48.56)::gis.geography,
                    '2026-09-02T10:00:00Z', NULL, 'mystery squeaks',
                    (SELECT id FROM public.providers WHERE slug = 'orcasound'),
                    (SELECT id FROM public.collections WHERE slug = 'orcasound')),
                ('bout_TESTsplit', 'feed_1', 'Test Lab', gis.ST_Point(-123.17, 48.56)::gis.geography,
                    '2026-09-03T10:00:00Z', NULL, NULL,
                    (SELECT id FROM public.providers WHERE slug = 'orcasound'),
                    (SELECT id FROM public.collections WHERE slug = 'orcasound'))`;
            await tx`INSERT INTO public.acoustic_bout_entities (bout_id, entity_id) VALUES
                ('bout_TESTtwo', ${POD}), ('bout_TESTtwo', ${ECO}), ('bout_TESTtwo', ${HUMP}),
                ('bout_TESTsplit', ${SPLIT})`;

            rows = await tx<Row[]>`
                SELECT id, (taxon).entity_id AS taxon_entity, (taxon).scientific_name, (taxon).vernacular_name,
                       identifiers, observed_at, observed_until,
                       (location).lon AS lon, (location).lat AS lat,
                       provider_slug, collection, body, url
                FROM public.occurrences
                WHERE id LIKE 'orcasound:bout_TEST%'
                ORDER BY id`;
            throw new Rollback();
        }).catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
    });

    test('a bout citing two species is two occurrences, one per species', () => {
        expect(rows.map((r) => r.id)).toEqual([
            `orcasound:bout_TESTtwo:${ORCA}`,
            `orcasound:bout_TESTtwo:${HUMP}`,
        ]);
    });

    test('the taxon is the species, named as the register names it', () => {
        const orca = rows.find((r) => r.taxon_entity === ORCA)!;
        expect(orca.scientific_name).toBe('Testus orca');
        expect(orca.vernacular_name).toBe('Test killer whale');
    });

    test('the identifiers are the cited groups under that species, and never the species', () => {
        const orca = rows.find((r) => r.taxon_entity === ORCA)!;
        const hump = rows.find((r) => r.taxon_entity === HUMP)!;
        expect(orca.identifiers).toEqual(['J', 'Test Resident']);
        expect(hump.identifiers).toEqual([]);
    });

    test('spans the bout, at the hydrophone, under Orcasound', () => {
        const orca = rows.find((r) => r.taxon_entity === ORCA)!;
        expect(orca.observed_at.toISOString()).toBe('2026-09-01T10:00:00.000Z');
        expect(orca.observed_until?.toISOString()).toBe('2026-09-01T10:30:00.000Z');
        expect(orca.lon).toBeCloseTo(-123.17, 5);
        expect(orca.lat).toBeCloseTo(48.56, 5);
        expect(orca.provider_slug).toBe('orcasound');
        expect(orca.collection).toBe('Orcasound');
        expect(orca.body).toBe('SRKW and a humpback');
        expect(orca.url).toBe('https://live.orcasound.net/bouts/bout_TESTtwo');
    });

    test('a bout citing no entity, or only one the register cannot place, is shown nowhere', () => {
        expect(rows.some((r) => r.id.startsWith('orcasound:bout_TESTnone'))).toBe(false);
        expect(rows.some((r) => r.id.startsWith('orcasound:bout_TESTsplit'))).toBe(false);
    });
});
