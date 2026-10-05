/**
 * The catalogue, read from checked-in data rather than from Postgres (decision 064,
 * salish-9uu.2.3): the individuals, their designations and nicknames, the social groups,
 * the parties who name and catalogue them, and the haul-out sites.
 *
 *   node scripts/read-path/catalogue.ts <snapshot.duckdb>
 *
 * They are ours: seeded once from the Bigg's sheet and the 2000 WDFW atlas, corrected
 * since by hand, and written by nothing in the app, so a curator changes them by a pull
 * request to data/catalogue/. Each file holds what is ours and nothing derived. What is
 * derived is computed here, as Postgres computed it:
 *
 *   - `designations.code_folded` and `social_groups.designation_folded`, the register's
 *     comparison form of a code (src/fold.ts; Postgres's generated columns use its SQL
 *     twin, register.fold);
 *   - an individual's sex, birth years and life status, which are the register's (decision
 *     051): Postgres copied them on every register load (refresh_individual_vitals), and
 *     here they come from the release the build holds (register.vitals, register.current_status).
 *
 * The rights policy's withheld columns are not in the files at all (D-21): the Bigg's
 * sheet's notes on an individual and the story behind a nickname. They stay in Postgres
 * until the store replaces it.
 *
 * Each table is written into the snapshot under the name and in the shape the snapshot
 * gave Postgres's: `snapshot.<table>`, one document per row, keys in jsonb's order
 * (shorter first, then bytewise), so the pages, the profile links and the identifier
 * candidates read them unchanged.
 */

import * as path from 'node:path';

import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';

import { fold } from '../../src/fold.ts';
import { budget } from './duckdb-budget.ts';
import { assertHeader, readTsv } from './reference.ts';

export const CATALOGUE_DIR = path.join(import.meta.dirname, '..', '..', 'data', 'catalogue');

type Column = readonly [string, string];

/** Each table: its file and the columns it holds, in the file's order, typed. */
export const CATALOGUE: Readonly<Record<string, {file: string, columns: readonly Column[]}>> = {
    individuals: {file: 'individuals.tsv', columns: [
        ['id', 'INTEGER'], ['entity_id', 'VARCHAR'], ['primary_designation', 'VARCHAR'],
        ['mother_id', 'INTEGER'], ['maternity_certainty', 'VARCHAR'],
        ['father_id', 'INTEGER'], ['paternity_certainty', 'VARCHAR']]},
    designations: {file: 'designations.tsv', columns: [
        ['id', 'INTEGER'], ['individual_id', 'INTEGER'], ['code', 'VARCHAR'], ['scheme', 'VARCHAR'],
        ['status', 'VARCHAR'], ['is_primary', 'BOOLEAN'], ['in_catalog', 'BOOLEAN'],
        ['superseded_by', 'INTEGER'], ['authority_id', 'INTEGER']]},
    parties: {file: 'parties.tsv', columns: [
        ['id', 'INTEGER'], ['name', 'VARCHAR'], ['kind', 'VARCHAR'], ['url', 'VARCHAR']]},
    social_groups: {file: 'social-groups.tsv', columns: [
        ['id', 'INTEGER'], ['kind', 'VARCHAR'], ['designation', 'VARCHAR'], ['entity_id', 'VARCHAR'],
        ['anchor_individual_id', 'INTEGER'], ['notes', 'VARCHAR']]},
    nicknames: {file: 'nicknames.tsv', columns: [
        ['id', 'INTEGER'], ['individual_id', 'INTEGER'], ['social_group_id', 'INTEGER'], ['name', 'VARCHAR'],
        ['status', 'VARCHAR'], ['namer_id', 'INTEGER'], ['named_year', 'INTEGER'], ['theme', 'VARCHAR']]},
    // A site's location is two columns, and its atlas species a comma-separated list.
    haulouts: {file: 'haulouts.tsv', columns: [
        ['id', 'INTEGER'], ['name', 'VARCHAR'], ['region', 'VARCHAR'], ['lat', 'DOUBLE'], ['lon', 'DOUBLE'],
        ['radius_m', 'INTEGER'], ['atlas_code', 'VARCHAR'], ['atlas_species', 'VARCHAR'],
        ['atlas_count', 'VARCHAR'], ['atlas_tidal_use', 'VARCHAR'], ['atlas_description', 'VARCHAR'],
        ['story', 'VARCHAR'], ['verified', 'BOOLEAN'], ['created_at', 'VARCHAR']]},
};

type Row = Record<string, unknown>;

/**
 * What Postgres enforced on these tables, enforced here instead: in Postgres a bad row was
 * refused on insert, and in a file it is only text. Their NOT NULLs, uniques (a NULL never
 * collides, as in Postgres), foreign keys, enum types and CHECKs, as their migrations
 * declare them; the enums' labels are the checked-in data/reference/enums.tsv, which CI
 * holds equal to a fresh migration replay. A build whose catalogue breaks any of them
 * fails the catalogue task, naming every row that does.
 */
export const CONSTRAINTS = {
    notNull: {
        individuals: ['id', 'primary_designation', 'maternity_certainty'],
        designations: ['id', 'individual_id', 'code', 'scheme', 'is_primary', 'status', 'in_catalog'],
        parties: ['id', 'name'],
        social_groups: ['id', 'kind', 'designation'],
        nicknames: ['id', 'name', 'status'],
        haulouts: ['id', 'name', 'lat', 'lon', 'radius_m', 'verified', 'created_at'],
    } as Record<string, string[]>,
    unique: [
        ['individuals', ['id']], ['individuals', ['primary_designation']], ['individuals', ['entity_id']],
        ['designations', ['id']], ['designations', ['code']],
        ['parties', ['id']], ['parties', ['name']],
        ['social_groups', ['id']], ['social_groups', ['designation']], ['social_groups', ['entity_id']],
        ['nicknames', ['id']], ['nicknames', ['individual_id', 'name']], ['nicknames', ['social_group_id', 'name']],
        ['haulouts', ['id']],
    ] as [string, string[]][],
    references: [
        ['individuals', 'mother_id', 'individuals'], ['individuals', 'father_id', 'individuals'],
        ['designations', 'individual_id', 'individuals'], ['designations', 'superseded_by', 'designations'],
        ['designations', 'authority_id', 'parties'],
        ['nicknames', 'individual_id', 'individuals'], ['nicknames', 'social_group_id', 'social_groups'],
        ['nicknames', 'namer_id', 'parties'],
        ['social_groups', 'anchor_individual_id', 'individuals'],
    ] as [string, string, string][],
    enums: [
        ['individuals', 'maternity_certainty', 'public.parentage_certainty'],
        ['individuals', 'paternity_certainty', 'public.parentage_certainty'],
        ['designations', 'scheme', 'public.designation_scheme'],
        ['designations', 'status', 'public.designation_status'],
        ['parties', 'kind', 'public.party_kind'],
        ['social_groups', 'kind', 'public.social_group_kind'],
        ['nicknames', 'status', 'public.nickname_status'],
    ] as [string, string, string][],
    // [table, what every row must do, the condition that says it does]
    checks: [
        ['nicknames', 'name exactly one individual or group', '(individual_id IS NULL) <> (social_group_id IS NULL)'],
        ['haulouts', 'have a radius from 50 to 5,000 metres', 'radius_m BETWEEN 50 AND 5000'],
    ] as [string, string, string][],
};

/** Every row of the loaded files (temp views `cat_<table>`) that breaks a constraint, described. */
async function violations(conn: DuckDBConnection): Promise<string[]> {
    const found: string[] = [];
    const ids = async (sql: string) =>
        (await conn.runAndReadAll(sql)).getRows().map(r => r.map(v => String(v)).join('/'));
    const report = (what: string, rows: string[]) => {
        if (rows.length) found.push(`${what}: ${rows.slice(0, 10).join(', ')}${rows.length > 10 ? `, and ${rows.length - 10} more` : ''}`);
    };
    for (const [table, columns] of Object.entries(CONSTRAINTS.notNull))
        for (const column of columns)
            report(`${table}.${column} is empty in row`, await ids(`SELECT id FROM cat_${table} WHERE ${column} IS NULL`));
    for (const [table, columns] of CONSTRAINTS.unique)
        report(`${table} repeats (${columns.join(', ')})`, await ids(
            `SELECT ${columns.join(', ')} FROM cat_${table} WHERE ${columns.map(c => `${c} IS NOT NULL`).join(' AND ')}
             GROUP BY ALL HAVING count(*) > 1`));
    for (const [table, column, target] of CONSTRAINTS.references)
        report(`${table}.${column} names no row of ${target}, in row`, await ids(
            `SELECT t.id FROM cat_${table} t WHERE t.${column} IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM cat_${target} r WHERE r.id = t.${column})`));
    for (const [table, column, type] of CONSTRAINTS.enums) {
        const labels = await conn.runAndReadAll(`SELECT count(*) FROM store.types.enums WHERE type = '${type}'`);
        if (Number(labels.getRows()[0]![0]) === 0) found.push(`${type} has no labels in types.enums`);
        report(`${table}.${column} is not a ${type}`, await ids(
            `SELECT DISTINCT ${column} FROM cat_${table} WHERE ${column} IS NOT NULL
             AND ${column} NOT IN (SELECT label FROM store.types.enums WHERE type = '${type}')`));
    }
    // As a CHECK does, a condition that comes out NULL passes; NOT NULL is checked above.
    for (const [table, what, holds] of CONSTRAINTS.checks)
        report(`${table} rows must ${what}; these don't`, await ids(`SELECT id FROM cat_${table} WHERE NOT (${holds})`));
    return found;
}

/** An object with its keys in jsonb's order — shorter first, then bytewise — as Postgres stores them. */
export function jsonbOrdered(row: Row): Row {
    const keys = Object.keys(row).sort((a, b) =>
        Buffer.byteLength(a) - Buffer.byteLength(b) || Buffer.compare(Buffer.from(a), Buffer.from(b)));
    return Object.fromEntries(keys.map(k => [k, row[k]]));
}

/** What a table's document carries beyond its file's columns, computed as Postgres computed it. */
export function documents(table: string, rows: readonly Row[], vitals: ReadonlyMap<number, Row>): string[] {
    return rows.map(row => {
        let doc: Row = {...row};
        if (table === 'designations') doc['code_folded'] = row['code'] === null ? null : fold(row['code'] as string);
        if (table === 'social_groups')
            doc['designation_folded'] = row['designation'] === null ? null : fold(row['designation'] as string);
        if (table === 'haulouts') {
            const {lat, lon, atlas_species: species, ...rest} = doc;
            doc = {
                ...rest,
                location: lat === null && lon === null ? null : {lat, lon},
                atlas_species: species === null ? null : (species as string).split(','),
            };
        }
        if (table === 'individuals') {
            const v = vitals.get(row['id'] as number);
            if (!v) throw new Error(`individuals.tsv: individual ${String(row['id'])} has no register entity to take its vitals from`);
            doc = {...doc, ...v};
        }
        return JSON.stringify(jsonbOrdered(doc));
    });
}

/**
 * Each individual's sex, birth years and life status from the register the build holds:
 * public.refresh_individual_vitals, twinned. A birth is 'YYYY', 'YYYY-MM', or '../YYYY'
 * (born by then); a status the register doesn't record is 'unknown'. Postgres keeps an
 * individual's old values when the register holds no statuses at all; this refuses
 * instead, since every release carries them.
 */
async function registerVitals(conn: DuckDBConnection, individuals: string): Promise<Map<number, Row>> {
    const statuses = await conn.runAndReadAll('SELECT count(*) FROM store.register.current_status');
    if (Number(statuses.getRows()[0]![0]) === 0) throw new Error('register.current_status is empty: no life status to give any individual');
    const reader = await conn.runAndReadAll(`
        SELECT i.id,
               CASE v.sex WHEN 'F' THEN 'female' WHEN 'M' THEN 'male' END AS sex,
               CASE WHEN regexp_full_match(v.born, '\\d{4}(-\\d{2})?') THEN CAST(left(v.born, 4) AS INTEGER) END AS born_earliest,
               CASE WHEN regexp_full_match(v.born, '\\d{4}(-\\d{2})?') THEN CAST(left(v.born, 4) AS INTEGER)
                    WHEN regexp_full_match(v.born, '\\.\\./\\d{4}(-\\d{2})?') THEN CAST(substr(v.born, 4, 4) AS INTEGER)
               END AS born_latest,
               CASE s.status WHEN 'alive' THEN 'alive' WHEN 'dead' THEN 'deceased'
                             WHEN 'presumed_dead' THEN 'presumed_deceased' ELSE 'unknown' END AS life_status
        FROM ${individuals} i
        JOIN store.register.vitals v ON v.entity_id = i.entity_id
        LEFT JOIN store.register.current_status s ON s.entity_id = i.entity_id`);
    return new Map(reader.getRowObjectsJS().map(r => {
        const {id, ...vitals} = r as Row;
        return [Number(id), vitals];
    }));
}

/** Load every catalogue table into `store.snapshot`, replacing what was there, in one transaction. */
export async function loadCatalogue(snapshot: string, dir = CATALOGUE_DIR): Promise<Record<string, number>> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await budget(conn, snapshot, '64MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store`);
        const read = (table: string) => readTsv(path.join(dir, CATALOGUE[table]!.file), CATALOGUE[table]!.columns);
        for (const [table, {file, columns}] of Object.entries(CATALOGUE)) {
            assertHeader(path.join(dir, file), columns);
            await conn.run(`CREATE TEMP VIEW cat_${table} AS SELECT * FROM ${read(table)}`);
        }
        const broken = await violations(conn);
        if (broken.length) throw new Error(`the catalogue breaks what Postgres enforced:\n  ${broken.join('\n  ')}`);
        const vitals = await registerVitals(conn, read('individuals'));
        const docs: Record<string, string[]> = {};
        for (const table of Object.keys(CATALOGUE)) {
            const rows = (await conn.runAndReadAll(`SELECT * FROM ${read(table)}`)).getRowObjectsJS() as Row[];
            if (rows.length === 0) throw new Error(`${CATALOGUE[table]!.file}: no rows`);
            docs[table] = documents(table, rows, vitals);
        }
        await conn.run('CREATE SCHEMA IF NOT EXISTS store.snapshot');
        await conn.run('BEGIN');
        for (const [table, list] of Object.entries(docs)) {
            await conn.run(`CREATE OR REPLACE TABLE store.snapshot.${table} (doc VARCHAR)`);
            const insert = await conn.prepare(`INSERT INTO store.snapshot.${table} VALUES ($1)`);
            for (const doc of list) {
                insert.bindVarchar(1, doc);
                await insert.run();
            }
        }
        await conn.run('COMMIT');
        return Object.fromEntries(Object.entries(docs).map(([t, l]) => [t, l.length]));
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}

export async function main(): Promise<void> {
    const [snapshot] = process.argv.slice(2);
    if (!snapshot) {
        console.error('usage: catalogue.ts <snapshot.duckdb>');
        process.exit(2);
    }
    for (const [table, n] of Object.entries(await loadCatalogue(snapshot)))
        console.log(`snapshot.${table}: ${n} rows`);
}

if (import.meta.main) {
    await main();
}
