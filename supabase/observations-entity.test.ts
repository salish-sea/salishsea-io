/**
 * Our own sightings are keyed on a register entity (salish-53t.3, migration 20260922040000).
 *
 * The key is an SSA: identifier; what a sighting is called, and what the archive and the
 * map's symbology see as its scientific name, are read through the register's crosswalk
 * at query time. These pin the parts of that which could quietly go wrong:
 *
 * - an ecotype resolves to the iNaturalist taxon it is itself crosswalked to, not to its
 *   species — otherwise every Bigg's sighting reads as plain Orcinus orca, and
 *   src/symbology.ts stops labelling it "Biggs";
 * - the entity's own exactMatch beats its closeMatch;
 * - a sighting keyed on an entity the register does not (yet) hold still appears on the
 *   map, unnamed, rather than vanishing — the taxa joins are LEFT for this;
 * - the column refuses anything that is not an SSA: identifier, which is what the form
 *   sent before this change.
 *
 * Seeds its own register rows in a rolled-back transaction: CI loads no register edition.
 * Gated on SUPABASE_DB_URL like the other integration tiers (decision 011).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import type { Sql, TransactionSql } from 'postgres';

const DSN = process.env['SUPABASE_DB_URL'];

// Well outside anything the register mints (register-crosswalk.test.ts uses 99000xx).
const ECOTYPE = 'SSA:9900101';
const BOTH = 'SSA:9900102';
const UNMAPPED = 'SSA:9900103';
const POD = 'SSA:9900104';
const OBSERVATION = '22222222-2222-4222-a222-222222222222';

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
 * A species exactMatched to Orcinus orca (and closeMatched to ater, so exact-before-close is
 * exercised), an ecotype under it closeMatched to rectipinnus, and a pod under the ecotype
 * with no mapping of its own. The ecotype's parent is what makes "its own mapping first"
 * load-bearing: without it there is only one candidate and any ordering passes.
 */
async function seedRegister(tx: TransactionSql) {
    await tx`INSERT INTO register.entities (entity_id, kind, rank, label) VALUES
        (${ECOTYPE}, 'group', 'ecotype', 'Test ecotype'),
        (${BOTH}, 'taxon', 'species', 'Test species'),
        (${UNMAPPED}, 'taxon', 'species', 'Not crosswalked'),
        (${POD}, 'group', 'pod', 'Test pod')`;
    await tx`INSERT INTO register.ancestor (entity_id, ancestor_id, depth, ancestor_kind) VALUES
        (${ECOTYPE}, ${BOTH}, 1, 'taxon'),
        (${POD}, ${ECOTYPE}, 1, 'group'),
        (${POD}, ${BOTH}, 2, 'taxon')`;
    await tx`INSERT INTO register.names (entity_id, name, type, language) VALUES
        (${ECOTYPE}, 'Test ecotype whale', 'common', 'en')`;
    await tx`INSERT INTO register.mappings (subject_id, predicate_id, object_id) VALUES
        (${ECOTYPE}, 'skos:closeMatch', 'inaturalist.taxon:1602533'),
        (${BOTH}, 'skos:closeMatch', 'inaturalist.taxon:1602531'),
        (${BOTH}, 'skos:exactMatch', 'inaturalist.taxon:41521')`;
}

async function insertObservation(tx: TransactionSql, entityId: string) {
    await tx`
        INSERT INTO public.observations
            (id, observed_at, subject_location, entity_id, contributor_id, user_uuid, created_at, updated_at)
        SELECT ${OBSERVATION}::uuid, now(), gis.ST_Point(-123, 48)::gis.geography, ${entityId},
               uc.contributor_id, uc.user_uuid, now(), now()
        FROM public.user_contributor uc LIMIT 1`;
}

describe.skipIf(!DSN)('observations keyed on a register entity (local Supabase)', () => {
    let sql: Sql;
    beforeAll(() => { sql = postgres(DSN!, { max: 1 }); });
    afterAll(async () => { await sql?.end(); });

    test('an ecotype resolves to the subspecies it is crosswalked to, not to its species', async () => {
        const taxon = await rolledBack(sql, async (tx) => {
            await seedRegister(tx);
            await insertObservation(tx, ECOTYPE);
            const [row] = await tx`
                SELECT (taxon).scientific_name, (taxon).vernacular_name, (taxon).entity_id
                FROM public.occurrences WHERE id = ${OBSERVATION}`;
            return row;
        });
        expect(taxon).toEqual({
            scientific_name: 'Orcinus orca rectipinnus',
            vernacular_name: 'Test ecotype whale',
            entity_id: ECOTYPE,
        });
    });

    test('the form\'s draft marker reads the name the saved sighting will', async () => {
        // animal_names.inaturalist_scientific_name is what src/sighting-form.ts styles its
        // unsaved marker by; if it ever resolved differently from the view, a Bigg's draft
        // would label as "Killer whale" and then turn into "Biggs" on save.
        const [draft, saved] = await rolledBack(sql, async (tx) => {
            await seedRegister(tx);
            await insertObservation(tx, ECOTYPE);
            const [a] = await tx`SELECT inaturalist_scientific_name AS n FROM public.animal_names WHERE entity_id = ${ECOTYPE}`;
            const [o] = await tx`SELECT (taxon).scientific_name AS n FROM public.occurrences WHERE id = ${OBSERVATION}`;
            return [a?.['n'], o?.['n']];
        });
        expect(draft).toBe('Orcinus orca rectipinnus');
        expect(draft).toBe(saved);
    });

    test('an entity with no mapping of its own takes its species\'', async () => {
        const id = await rolledBack(sql, async (tx) => {
            await seedRegister(tx);
            const [row] = await tx`SELECT register.inaturalist_taxon_for(${POD}) AS id`;
            return row?.['id'];
        });
        expect(id).toBe(41521);
    });

    test('exactMatch beats closeMatch', async () => {
        const id = await rolledBack(sql, async (tx) => {
            await seedRegister(tx);
            const [row] = await tx`SELECT register.inaturalist_taxon_for(${BOTH}) AS id`;
            return row?.['id'];
        });
        expect(id).toBe(41521);
    });

    test('a sighting of an entity with no crosswalk stays on the map, unnamed', async () => {
        const row = await rolledBack(sql, async (tx) => {
            await seedRegister(tx);
            await insertObservation(tx, UNMAPPED);
            const [row] = await tx`
                SELECT (taxon).scientific_name, (taxon).entity_id
                FROM public.occurrences WHERE id = ${OBSERVATION}`;
            return row;
        });
        expect(row).toEqual({ scientific_name: null, entity_id: UNMAPPED });
    });

    test('a scientific name is not an entity', async () => {
        await expect(rolledBack(sql, (tx) => insertObservation(tx, 'Orcinus orca')))
            .rejects.toThrow(/observations_entity_id_format/);
    });
});
