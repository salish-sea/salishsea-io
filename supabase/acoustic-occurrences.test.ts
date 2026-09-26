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
const IND = 'SSA:9810001';    // an individual under the pod

class Rollback extends Error {}

type Row = {
    id: string; taxon_entity: string | null; scientific_name: string | null; vernacular_name: string | null;
    identifiers: string[]; certainty: string | null; observed_at: Date; observed_until: Date | null;
    lon: number; lat: number; provider_slug: string; collection: string; body: string | null; url: string;
};
type Claim = {
    occurrence_id: string; individual_id: number | null; social_group_id: number | null;
    evidence: string; method: string; status: string; certainty: string | null; code: string;
};

describe.skipIf(!DSN)('public.occurrences: the Orcasound branch (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN as string, { prepare: false, max: 1 }); });
    afterAll(async () => { await sql.end(); });

    let rows: Row[] = [];
    let claims: Claim[] = [];
    let candidates = -1;
    let groupId = -1;
    let individualId = -1;

    beforeAll(async () => {
        await sql.begin(async (tx) => {
            await tx`INSERT INTO register.entities (entity_id, kind, rank, label) VALUES
                (${ORCA}, 'taxon', 'species', 'Testus orca'),
                (${HUMP}, 'taxon', 'species', 'Testus humpback'),
                (${ECO}, 'group', 'ecotype', 'Test Resident'),
                (${POD}, 'group', 'pod', 'J'),
                (${IND}, 'individual', NULL, 'J99'),
                (${SPLIT}, 'group', 'pod', 'Gone')`;
            await tx`INSERT INTO register.names (entity_id, name, type, language) VALUES
                (${ORCA}, 'Test killer whale', 'common', 'en')`;
            await tx`INSERT INTO register.ancestor (entity_id, ancestor_id, depth, ancestor_kind) VALUES
                (${POD}, ${ECO}, 1, 'group'),
                (${POD}, ${ORCA}, 2, 'taxon'),
                (${ECO}, ${ORCA}, 1, 'taxon'),
                (${IND}, ${POD}, 1, 'group'),
                (${IND}, ${ECO}, 2, 'group'),
                (${IND}, ${ORCA}, 3, 'taxon')`;
            await tx`INSERT INTO register.deprecations (entity_id, replaced_by, reason) VALUES (${SPLIT}, NULL, 'split')`;
            // Subjects here for two of the cited entities; the ecotype has none, and stays a label.
            const [g] = await tx<{ id: number }[]>`INSERT INTO public.social_groups (designation, kind, entity_id) VALUES ('TESTJ', 'pod', ${POD}) RETURNING id`;
            const [i] = await tx<{ id: number }[]>`INSERT INTO public.individuals (primary_designation, entity_id) VALUES ('TESTJ99', ${IND}) RETURNING id`;
            groupId = g!.id; individualId = i!.id;

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
                    (SELECT id FROM public.collections WHERE slug = 'orcasound')),
                ('bout_TESThedged', 'feed_1', 'Test Lab', gis.ST_Point(-123.17, 48.56)::gis.geography,
                    '2026-09-04T10:00:00Z', NULL, 'J? and a whale',
                    (SELECT id FROM public.providers WHERE slug = 'orcasound'),
                    (SELECT id FROM public.collections WHERE slug = 'orcasound'))`;
            // Certainty is the moderator's (054): the pod is a hedge on the first bout and
            // the ecotype was never asked about; the humpback is only possibly there. On the
            // fourth bout everything reaching the species is hedged.
            await tx`INSERT INTO public.acoustic_bout_entities (bout_id, entity_id, certainty) VALUES
                ('bout_TESTtwo', ${POD}, 'possible'), ('bout_TESTtwo', ${ECO}, NULL), ('bout_TESTtwo', ${HUMP}, 'possible'),
                ('bout_TESTsplit', ${SPLIT}, 'certain'),
                ('bout_TESThedged', ${POD}, 'possible'), ('bout_TESThedged', ${IND}, 'probable')`;

            rows = await tx<Row[]>`
                SELECT id, (taxon).entity_id AS taxon_entity, (taxon).scientific_name, (taxon).vernacular_name,
                       identifiers, certainty, observed_at, observed_until,
                       (location).lon AS lon, (location).lat AS lat,
                       provider_slug, collection, body, url
                FROM public.occurrences
                WHERE id LIKE 'orcasound:bout_TEST%'
                ORDER BY id`;
            claims = await tx<Claim[]>`
                SELECT occurrence_id, individual_id, social_group_id, evidence, method, status, certainty, code
                FROM public.occurrence_identifications
                WHERE occurrence_id LIKE 'orcasound:bout_TEST%'
                ORDER BY occurrence_id, code`;
            // The text candidates are a materialized view; refreshed here so the assertion
            // that bouts are NOT in it sees these bouts.
            await tx`REFRESH MATERIALIZED VIEW public.occurrence_identifier_candidates`;
            const [c] = await tx<{ n: number }[]>`
                SELECT count(*)::int AS n FROM public.occurrence_identifier_candidates WHERE occurrence_id LIKE 'orcasound:%'`;
            candidates = c!.n;
            throw new Rollback();
        }).catch((e: unknown) => { if (!(e instanceof Rollback)) throw e; });
    });

    test('a bout citing two species is two occurrences, one per species', () => {
        expect(rows.map((r) => r.id)).toEqual([
            `orcasound:bout_TESThedged:${ORCA}`,
            `orcasound:bout_TESTtwo:${ORCA}`,
            `orcasound:bout_TESTtwo:${HUMP}`,
        ]);
    });

    test('the taxon is the species, named as the register names it', () => {
        const orca = rows.find((r) => r.id === `orcasound:bout_TESTtwo:${ORCA}`)!;
        expect(orca.scientific_name).toBe('Testus orca');
        expect(orca.vernacular_name).toBe('Test killer whale');
    });

    test('the identifiers are the cited groups under that species, and never the species', () => {
        const orca = rows.find((r) => r.id === `orcasound:bout_TESTtwo:${ORCA}`)!;
        const hump = rows.find((r) => r.id === `orcasound:bout_TESTtwo:${HUMP}`)!;
        expect(orca.identifiers).toEqual(['J?', 'Test Resident']);
        expect(hump.identifiers).toEqual([]);
    });

    test('a possible identifier carries its mark, and the species is hedged only when every claim reaching it is (054)', () => {
        const two = rows.find((r) => r.id === `orcasound:bout_TESTtwo:${ORCA}`)!;
        const hump = rows.find((r) => r.id === `orcasound:bout_TESTtwo:${HUMP}`)!;
        const hedged = rows.find((r) => r.id === `orcasound:bout_TESThedged:${ORCA}`)!;
        expect(two.certainty).toBeNull();           // the ecotype was never asked about: unhedged
        expect(hump.certainty).toBe('possible');    // its only claim is a hedge
        expect(hedged.certainty).toBe('probable');  // every claim hedged; the strongest degree
        expect(hedged.identifiers).toEqual(['J?', 'J99']);
    });

    test('a cited group or animal is an identification with the moderator\'s certainty, not a text mention', () => {
        expect(claims).toEqual([
            { occurrence_id: `orcasound:bout_TESThedged:${ORCA}`, individual_id: null, social_group_id: groupId,
              evidence: 'acoustic', method: 'upstream_import', status: 'candidate', certainty: 'possible', code: 'J' },
            { occurrence_id: `orcasound:bout_TESThedged:${ORCA}`, individual_id: individualId, social_group_id: null,
              evidence: 'acoustic', method: 'upstream_import', status: 'candidate', certainty: 'probable', code: 'J99' },
            { occurrence_id: `orcasound:bout_TESTtwo:${ORCA}`, individual_id: null, social_group_id: groupId,
              evidence: 'acoustic', method: 'upstream_import', status: 'candidate', certainty: 'possible', code: 'J' },
        ]);
    });

    test('bouts are not text candidates: nothing of theirs is folded or sits in the unresolved codes', () => {
        expect(candidates).toBe(0);
    });

    test('spans the bout, at the hydrophone, under Orcasound', () => {
        const orca = rows.find((r) => r.id === `orcasound:bout_TESTtwo:${ORCA}`)!;
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
