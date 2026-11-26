/**
 * The catalogue, read from the register and from checked-in data rather than from Postgres
 * (decisions 064, 070 and 123): the individuals, their designations and nicknames, the social
 * groups, the parties who name and catalogue them, and the haul-out sites.
 *
 *   node scripts/read-path/catalogue.ts <snapshot.duckdb>
 *
 * Every individual and every social group is generated, on every build, from the register
 * edition the build holds, for each population in GENERATED_POPULATIONS (the Southern
 * Residents' community and the Bigg's ecotype): the animals, their primary designations and
 * mothers, and the population, its pods and its matrilines. No file holds them. What the
 * register does not give is ours, and lives in data/catalogue/, changed by a pull request:
 *
 *   - designations.tsv: the designations other than the primary one (the Alaska and
 *     California codes, and a code an animal no longer has), and the few flags we set on a
 *     primary designation (not in the catalogue, or uncertain). Every row names an animal by
 *     its register identifier;
 *   - nicknames.tsv: a nickname's status, who gave it and when, for an animal or a matriline,
 *     named by its register identifier;
 *   - parties.tsv and haulouts.tsv: the parties who name and catalogue, and the haul-out sites.
 *
 * A row of those files that names an entity no generated row stands for fails the build,
 * with the row named. So does a register whose generated population has animals but none
 * with a recorded mother, as an edition from before the register recorded the Bigg's mothers
 * would be (decision 123). The generated and the checked-in rows are held to the same
 * constraints, together.
 *
 * What is derived is computed here, as Postgres computed it:
 *
 *   - `designations.code_folded` and `social_groups.designation_folded`, the register's
 *     comparison form of a code (src/fold.ts; Postgres's generated columns use its SQL
 *     twin, register.fold);
 *   - an individual's sex, birth years and life status, which are the register's (decision
 *     051): Postgres copied them on every register load (refresh_individual_vitals), and
 *     here they come from the release the build holds (register.vitals, register.current_status);
 *   - the matriarch a matriline is named for, `social_groups.anchor_individual_id`, also the
 *     register's since it began naming her (register.matriarchs, animals ADR-0024).
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

import type { DuckDBConnection } from '@duckdb/node-api';

import { fold } from '../../src/fold.ts';
import { withSnapshot } from './duckdb-budget.ts';
import { assertHeader, readTsv } from './reference.ts';
import { attachRegister, registerFile } from './register-file.ts';

export const CATALOGUE_DIR = path.join(import.meta.dirname, '..', '..', 'data', 'catalogue');

type Column = readonly [string, string];

/**
 * Each table of the snapshot: the columns it holds, typed, and the checked-in file that
 * supplies some or all of its rows, if any. A table with no file is generated whole
 * (individuals, social_groups). A file's own columns, `fileColumns`, are those of the table
 * unless it is keyed differently: a designation or nickname there names its animal by
 * register identifier, `entity_id`, which the generated rows resolve to an internal id.
 */
export const CATALOGUE: Readonly<Record<string, {file: string | null, columns: readonly Column[], fileColumns?: readonly Column[]}>> = {
    individuals: {file: null, columns: [
        ['id', 'INTEGER'], ['entity_id', 'VARCHAR'], ['primary_designation', 'VARCHAR'],
        ['mother_id', 'INTEGER'], ['maternity_certainty', 'VARCHAR'],
        ['father_id', 'INTEGER'], ['paternity_certainty', 'VARCHAR']]},
    designations: {file: 'designations.tsv', columns: [
        ['id', 'INTEGER'], ['individual_id', 'INTEGER'], ['code', 'VARCHAR'], ['scheme', 'VARCHAR'],
        ['status', 'VARCHAR'], ['is_primary', 'BOOLEAN'], ['in_catalog', 'BOOLEAN'],
        ['superseded_by', 'INTEGER'], ['authority_id', 'INTEGER']],
    // A primary designation's row holds no id (it is generated, and is its animal's id) and
    // overrides the generated status, in_catalog and authority; any other row holds its own id.
    fileColumns: [
        ['id', 'INTEGER'], ['entity_id', 'VARCHAR'], ['code', 'VARCHAR'], ['scheme', 'VARCHAR'],
        ['status', 'VARCHAR'], ['is_primary', 'BOOLEAN'], ['in_catalog', 'BOOLEAN'], ['authority_id', 'INTEGER']]},
    parties: {file: 'parties.tsv', columns: [
        ['id', 'INTEGER'], ['name', 'VARCHAR'], ['kind', 'VARCHAR'], ['url', 'VARCHAR']]},
    social_groups: {file: null, columns: [
        ['id', 'INTEGER'], ['kind', 'VARCHAR'], ['designation', 'VARCHAR'], ['entity_id', 'VARCHAR'],
        ['anchor_individual_id', 'INTEGER'], ['notes', 'VARCHAR']]},
    nicknames: {file: 'nicknames.tsv', columns: [
        ['id', 'INTEGER'], ['individual_id', 'INTEGER'], ['social_group_id', 'INTEGER'], ['name', 'VARCHAR'],
        ['status', 'VARCHAR'], ['namer_id', 'INTEGER'], ['named_year', 'INTEGER'], ['theme', 'VARCHAR']],
    fileColumns: [
        ['id', 'INTEGER'], ['entity_id', 'VARCHAR'], ['name', 'VARCHAR'],
        ['status', 'VARCHAR'], ['namer_id', 'INTEGER'], ['named_year', 'INTEGER'], ['theme', 'VARCHAR']]},
    // A site's location is two columns, and its atlas species a comma-separated list.
    haulouts: {file: 'haulouts.tsv', columns: [
        ['id', 'INTEGER'], ['name', 'VARCHAR'], ['region', 'VARCHAR'], ['lat', 'DOUBLE'], ['lon', 'DOUBLE'],
        ['radius_m', 'INTEGER'], ['atlas_code', 'VARCHAR'], ['atlas_species', 'VARCHAR'],
        ['atlas_count', 'VARCHAR'], ['atlas_tidal_use', 'VARCHAR'], ['atlas_description', 'VARCHAR'],
        ['story', 'VARCHAR'], ['verified', 'BOOLEAN'], ['created_at', 'VARCHAR']]},
};

/** The columns the checked-in file of `table` holds, in order. */
export const fileColumns = (table: string): readonly Column[] => CATALOGUE[table]!.fileColumns ?? CATALOGUE[table]!.columns;

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

/**
 * The populations whose catalogue rows are generated from the register (decisions 070 and
 * 123): each one, and every group and animal beneath it.
 */
export const GENERATED_POPULATIONS: readonly string[] = [
    'SSA:0000010', // the Southern Resident community
    'SSA:0000002', // the Bigg's ecotype
];

/**
 * A generated row's id, from the register identifier's seven digits: the same row from one
 * edition to the next, and clear of every id a checked-in row holds, which count up from 1.
 */
const GENERATED_ID_BASE = 10_000_000;
const generatedId = (column: string) => `CAST(${GENERATED_ID_BASE} + CAST(substr(${column}, 5) AS INTEGER) AS INTEGER)`;

/** The register's group ranks that become catalogue groups, and the kind each becomes. */
const GENERATED_GROUP_KINDS = ['ecotype', 'community', 'pod', 'matriline'];

/**
 * Temp views `gen_individuals`, `gen_designations` and `gen_social_groups`: the generated
 * rows, in their tables' columns. A matriline's designation is its matriarch's code, as the
 * Bigg's rows have it (T065A for the T065As), and a pod's is its letter (J for J pod):
 * the pages add the word. A mother, matriarch or member the register deprecated is left
 * out, so a row never points at one that isn't there; every mother's certainty is
 * 'presumed', as every Bigg's mother's is. A generated designation is the animal's primary
 * one, active and in the catalogue; the checked-in designations file overrides that where a
 * curator has said otherwise (loadCatalogue).
 *
 * A matriline gets a row (decision 123) when the register gives it two or more members, or
 * when its matriarch has a recorded calf, unless its members are exactly those of a line
 * inside it that also qualifies. Members are counted by descent (register.ancestor), not
 * only those placed directly in the line, and leave out deprecated animals. The register
 * gives every Bigg's T-number a line of its own, and a line of one whale would only repeat
 * that whale's page. A matriarch's calf is what makes a line a line even when the register
 * places the calf elsewhere (K28s holds K28 alone, and her calf K39 sits in K pod).
 */
export async function generatedRows(conn: DuckDBConnection): Promise<void> {
    const roots = GENERATED_POPULATIONS.map(id => `'${id}'`).join(', ');
    await conn.run(`CREATE TEMP VIEW gen_members AS
        SELECT entity_id FROM (
            SELECT entity_id FROM register.ancestor WHERE ancestor_id IN (${roots})
            UNION SELECT unnest([${roots}]) AS entity_id)
        WHERE entity_id NOT IN (SELECT entity_id FROM register.deprecations)`);
    await conn.run(`CREATE TEMP VIEW gen_individuals AS
        SELECT ${generatedId('e.entity_id')} AS id, e.entity_id, e.label AS primary_designation,
               ${generatedId('p.parent_id')} AS mother_id, 'presumed' AS maternity_certainty,
               CAST(NULL AS INTEGER) AS father_id, CAST(NULL AS VARCHAR) AS paternity_certainty
        FROM register.entities e
        JOIN gen_members USING (entity_id)
        LEFT JOIN register.parentage p ON p.child_id = e.entity_id AND p.role = 'mother'
            AND p.parent_id IN (SELECT entity_id FROM gen_members)
        WHERE e.kind = 'individual'`);
    await conn.run(`CREATE TEMP VIEW gen_designations AS
        SELECT id, id AS individual_id, primary_designation AS code, 'bc_wa' AS scheme, 'active' AS status,
               true AS is_primary, true AS in_catalog, CAST(NULL AS INTEGER) AS superseded_by,
               CAST(NULL AS INTEGER) AS authority_id
        FROM gen_individuals`);
    // The lines that qualify on their own, with how many animals each holds by descent.
    await conn.run(`CREATE TEMP VIEW gen_matriline_candidates AS
        WITH sizes AS (
            SELECT a.ancestor_id AS matriline_id, count(*) AS members
            FROM register.ancestor a
            JOIN gen_individuals i ON i.entity_id = a.entity_id
            GROUP BY a.ancestor_id)
        SELECT e.entity_id, coalesce(s.members, 0) AS members
        FROM register.entities e
        JOIN gen_members USING (entity_id)
        JOIN register.group_ranks r USING (entity_id)
        LEFT JOIN sizes s ON s.matriline_id = e.entity_id
        WHERE e.kind = 'group' AND r.rank = 'matriline'
          AND (coalesce(s.members, 0) >= 2 OR EXISTS (
              SELECT 1 FROM register.matriarchs m
              JOIN register.parentage p ON p.parent_id = m.matriarch_id AND p.role = 'mother'
              JOIN gen_individuals calf ON calf.entity_id = p.child_id
              WHERE m.matriline_id = e.entity_id))`);
    // A line inside another holds a subset of its animals, so equal counts mean equal sets.
    await conn.run(`CREATE TEMP VIEW gen_matrilines AS
        SELECT entity_id FROM gen_matriline_candidates outer_line
        WHERE NOT EXISTS (
            SELECT 1 FROM register.ancestor a
            JOIN gen_matriline_candidates nested ON nested.entity_id = a.entity_id
            WHERE a.ancestor_id = outer_line.entity_id AND nested.members = outer_line.members)`);
    await conn.run(`CREATE TEMP VIEW gen_social_groups AS
        SELECT ${generatedId('e.entity_id')} AS id, r.rank AS kind,
               CASE r.rank
                   WHEN 'matriline' THEN coalesce(matriarch.label, regexp_replace(e.label, 's$', ''))
                   WHEN 'pod' THEN regexp_replace(e.label, ' pod$', '')
                   ELSE e.label
               END AS designation,
               e.entity_id,
               CASE WHEN r.rank = 'matriline' THEN ${generatedId('matriarch.entity_id')} END AS anchor_individual_id,
               CAST(NULL AS VARCHAR) AS notes
        FROM register.entities e
        JOIN gen_members USING (entity_id)
        JOIN register.group_ranks r USING (entity_id)
        LEFT JOIN register.matriarchs m ON m.matriline_id = e.entity_id
            AND m.matriarch_id IN (SELECT entity_id FROM gen_members)
        LEFT JOIN register.entities matriarch ON matriarch.entity_id = m.matriarch_id
        WHERE e.kind = 'group' AND r.rank IN (${GENERATED_GROUP_KINDS.map(k => `'${k}'`).join(', ')})
          AND (r.rank <> 'matriline' OR e.entity_id IN (SELECT entity_id FROM gen_matrilines))`);
}

/**
 * The populations that have animals but none with a recorded mother. Decision 123 reads
 * the Bigg's mothers from the register, which records them from its edition with animals
 * ADR-0028 on; a register without them would strip every Bigg's whale of its mother, so the
 * build refuses it rather than publish that.
 */
async function populationsWithoutMothers(conn: DuckDBConnection): Promise<string[]> {
    const rows = (await conn.runAndReadAll(`
        SELECT p.entity_id, p.label FROM register.entities p
        WHERE p.entity_id IN (${GENERATED_POPULATIONS.map(id => `'${id}'`).join(', ')})
          AND EXISTS (SELECT 1 FROM register.ancestor a JOIN gen_individuals i ON i.entity_id = a.entity_id
                      WHERE a.ancestor_id = p.entity_id)
          AND NOT EXISTS (SELECT 1 FROM register.ancestor a
                          JOIN gen_individuals i ON i.entity_id = a.entity_id
                          WHERE a.ancestor_id = p.entity_id AND i.mother_id IS NOT NULL)`)).getRows();
    return rows.map(([id, label]) => `${String(label)} (${String(id)})`);
}

/**
 * The checked-in rows (temp views `file_<table>`, in the file's own columns) that name an
 * animal or group no generated row stands for, or are otherwise malformed, described.
 */
async function unresolvedFileRows(conn: DuckDBConnection): Promise<string[]> {
    const found: string[] = [];
    const list = async (what: string, sql: string) => {
        const rows = (await conn.runAndReadAll(sql)).getRows().map(r => r.map(v => String(v)).join('/'));
        if (rows.length) found.push(`${what}: ${rows.slice(0, 10).join(', ')}${rows.length > 10 ? `, and ${rows.length - 10} more` : ''}`);
    };
    await list('designations.tsv names an entity that is no generated animal (entity_id/code)',
        `SELECT entity_id, code FROM file_designations WHERE entity_id IS NULL
         OR entity_id NOT IN (SELECT entity_id FROM gen_individuals)`);
    await list('designations.tsv gives no id to a designation that is not primary (entity_id/code)',
        `SELECT entity_id, code FROM file_designations WHERE NOT is_primary AND id IS NULL`);
    await list('designations.tsv overrides one animal\'s primary designation more than once (entity_id)',
        `SELECT entity_id FROM file_designations WHERE is_primary GROUP BY entity_id HAVING count(*) > 1`);
    await list('nicknames.tsv names an entity that is no generated animal or group (id/entity_id)',
        `SELECT id, entity_id FROM file_nicknames WHERE entity_id IS NULL
         OR entity_id NOT IN (SELECT entity_id FROM gen_individuals UNION SELECT entity_id FROM gen_social_groups)`);
    return found;
}

/**
 * The SQL that gives each table's rows, generated and checked in together, in the table's
 * columns: it reads the temp views `gen_*` (generatedRows) and `file_<table>` (the files).
 */
const ROWS: Readonly<Record<string, string>> = {
    individuals: 'SELECT * FROM gen_individuals',
    social_groups: 'SELECT * FROM gen_social_groups',
    // The generated primary designations, with a checked-in row's status, in_catalog and
    // authority where one overrides them, and the checked-in designations of other kinds,
    // a superseded one pointing at its animal's primary designation (whose id is the animal's).
    designations: `
        SELECT g.id, g.individual_id, g.code, g.scheme, coalesce(f.status, g.status) AS status, g.is_primary,
               coalesce(f.in_catalog, g.in_catalog) AS in_catalog, g.superseded_by,
               coalesce(f.authority_id, g.authority_id) AS authority_id
        FROM gen_designations g
        JOIN gen_individuals i ON i.id = g.individual_id
        LEFT JOIN file_designations f ON f.entity_id = i.entity_id AND f.is_primary
        UNION ALL
        SELECT f.id, i.id, f.code, f.scheme, f.status, f.is_primary, f.in_catalog,
               CASE WHEN f.status = 'superseded' THEN i.id END, f.authority_id
        FROM file_designations f
        JOIN gen_individuals i ON i.entity_id = f.entity_id
        WHERE NOT f.is_primary`,
    // A nickname's entity is an animal or a group: the file's one column, resolved.
    nicknames: `
        SELECT f.id, i.id AS individual_id, g.id AS social_group_id, f.name, f.status, f.namer_id, f.named_year, f.theme
        FROM file_nicknames f
        LEFT JOIN gen_individuals i ON i.entity_id = f.entity_id
        LEFT JOIN gen_social_groups g ON g.entity_id = f.entity_id`,
};

/** Every row, generated or checked in (temp views `cat_<table>`), that breaks a constraint, described. */
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
            if (!v) throw new Error(`individual ${String(row['id'])} has no register entity to take its vitals from`);
            doc = {...doc, ...v};
        }
        return JSON.stringify(jsonbOrdered(doc));
    });
}

/**
 * Each individual's sex, birth years and life status from the register the build holds:
 * public.refresh_individual_vitals, at first twinned. A birth is an EDTF date, as the
 * register's glossary defines `born`: a year, a month or a day ('1998', '2020-09',
 * '2024-06-14'), perhaps uncertain or approximate ('1998?', '1979~'), or a range
 * ('1995/1998'), open at one end ('../1966', born by then; '1968/..', born then or
 * later). `born_earliest` is the year it opens with and `born_latest` the year it closes
 * with; an open end gives none. Postgres read only the first three forms and gave
 * nothing for the rest, which would have lost a birth the register records more
 * precisely (salish-fwyt.4.2). A status the register doesn't record is 'unknown'. Beyond the twin, the
 * year of a death (salish-fwyt.4.3): when a dead or presumed dead status took effect, if the
 * register dates it. '../2026-07', dead by then, gives no year; the Bigg's deaths all read so. Postgres keeps an
 * individual's old values when the register holds no statuses at all; this refuses
 * instead, since every release carries them.
 */
export async function registerVitals(conn: DuckDBConnection, individuals: string): Promise<Map<number, Row>> {
    const statuses = await conn.runAndReadAll('SELECT count(*) FROM register.current_status');
    if (Number(statuses.getRows()[0]![0]) === 0) throw new Error('register.current_status is empty: no life status to give any individual');
    // The year of one end of an EDTF date; none for an open end ('..') or anything else.
    await conn.run(`CREATE OR REPLACE TEMP MACRO edtf_year(d) AS
        CASE WHEN regexp_full_match(d, '\\d{4}(-\\d{2}){0,2}[?~%]?') THEN CAST(left(d, 4) AS INTEGER) END`);
    const reader = await conn.runAndReadAll(`
        SELECT i.id,
               CASE v.sex WHEN 'F' THEN 'female' WHEN 'M' THEN 'male' END AS sex,
               edtf_year(split_part(v.born, '/', 1)) AS born_earliest,
               edtf_year(CASE WHEN contains(v.born, '/') THEN split_part(v.born, '/', 2) ELSE v.born END) AS born_latest,
               CASE s.status WHEN 'alive' THEN 'alive' WHEN 'dead' THEN 'deceased'
                             WHEN 'presumed_dead' THEN 'presumed_deceased' ELSE 'unknown' END AS life_status,
               CASE WHEN s.status IN ('dead', 'presumed_dead') AND regexp_full_match(d.effective, '\\d{4}(-\\d{2}){0,2}')
                    THEN CAST(left(d.effective, 4) AS INTEGER) END AS died
        FROM ${individuals} i
        JOIN register.vitals v ON v.entity_id = i.entity_id
        LEFT JOIN register.current_status s ON s.entity_id = i.entity_id
        LEFT JOIN register.status_dates d ON d.entity_id = i.entity_id`);
    return new Map(reader.getRowObjectsJS().map(r => {
        const {id, ...vitals} = r as Row;
        return [Number(id), vitals];
    }));
}

/** Load every catalogue table into `store.snapshot`, replacing what was there, in one transaction. */
export async function loadCatalogue(snapshot: string, dir = CATALOGUE_DIR): Promise<Record<string, number>> {
    return withSnapshot(snapshot, {memory: '64MB', write: true}, async conn => {
        await attachRegister(conn, registerFile(snapshot));
        await generatedRows(conn);
        const missingMothers = await populationsWithoutMothers(conn);
        if (missingMothers.length)
            throw new Error(`the register edition records no mother for any animal of ${missingMothers.join(', ')}; `
                + 'the catalogue would publish them without mothers (decision 123)');
        for (const [table, {file}] of Object.entries(CATALOGUE)) {
            if (file === null) continue;
            assertHeader(path.join(dir, file), fileColumns(table));
            await conn.run(`CREATE TEMP VIEW file_${table} AS SELECT * FROM ${readTsv(path.join(dir, file), fileColumns(table))}`);
        }
        const list = (table: string) => CATALOGUE[table]!.columns.map(([name]) => name).join(', ');
        for (const table of Object.keys(CATALOGUE))
            await conn.run(`CREATE TEMP VIEW cat_${table} AS SELECT ${list(table)} FROM (${ROWS[table] ?? `SELECT * FROM file_${table}`})`);
        const broken = [...await unresolvedFileRows(conn), ...await violations(conn)];
        if (broken.length) throw new Error(`the catalogue breaks what Postgres enforced:\n  ${broken.join('\n  ')}`);
        const vitals = await registerVitals(conn, 'cat_individuals');
        const docs: Record<string, string[]> = {};
        for (const table of Object.keys(CATALOGUE)) {
            const rows = (await conn.runAndReadAll(`SELECT * FROM cat_${table} ORDER BY id`)).getRowObjectsJS() as Row[];
            if (rows.length === 0) throw new Error(`the catalogue's ${table} has no rows`);
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
    });
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
