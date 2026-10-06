/**
 * Derive the occurrences in the build (decision 061, salish-xv35.2): Maplify, iNaturalist
 * and Orcasound from the build's own mirrors (salish-xv35.9, derive/sources.sql), and
 * the rest (native sightings, Happywhale, the register, the reference tables) from the
 * snapshot's copies of Postgres's tables.
 *
 *   node scripts/read-path/derive-occurrences.ts <snapshot.duckdb> <maplify.sqlite> <inaturalist.sqlite> <orcasound.sqlite>
 *
 * Writes `build.occurrences` into the snapshot: id, observed_at and the document,
 * the shape of `snapshot.occurrences`, which holds Postgres's answer. The SQL is
 * derive/occurrences.sql, twins of the five Postgres views, after derive/shared.sql;
 * the two text extractions they call are macros from derive/extract.sql.
 * compare-occurrences.ts checks the result against Postgres's.
 *
 * One source at a time, and only the sources whose inputs changed when the build says
 * which (STELIS_CHANGED_INPUTS, Stelis ADR 0015; salish-9uu.8.1): a sighting saved here
 * changes the store's tables and nothing else, so its build re-derives the native arm's
 * few hundred rows and leaves the other ~63,000 as they were. Absent the variable, or
 * given an input every arm reads (the register, the reference tables, iNaturalist's taxa,
 * which name species for every source), the whole table is rebuilt as before.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { readFile } from 'node:fs/promises';

import { writeInaturalistOutOfScope } from './derive/inaturalist-scope.ts';
import { writeMaplifyEntities } from './derive/maplify-entities.ts';
import { attachSources, mirrorArgs, type Mirrors } from './derive/sources.ts';
import { budget } from './duckdb-budget.ts';

export const SOURCES = ['maplify', 'inaturalist', 'happywhale', 'native', 'orcasound'] as const;
export type Source = typeof SOURCES[number];

/**
 * The inputs each source's arm reads and no other arm does, by the names the build
 * declares them under (Stelis's salishsea.rkt, the derive-occurrences task). An input
 * absent from every list is one every arm reads — the register, the reference tables,
 * iNaturalist's taxa (every arm names its species through them), the enums — or one
 * declared since this was written; either way a change to it rebuilds every arm. Erring
 * toward "all" is the safe side: a full rebuild is always right, a missed arm is not.
 */
export const ARM_INPUTS: Readonly<Record<Source, readonly string[]>> = {
    maplify: ['maplify_mirror.sightings', 'maplify.collection_rule', 'maplify-names-hold'],
    inaturalist: ['inaturalist_mirror.observations', 'inaturalist_mirror.observation_photos'],
    happywhale: ['happywhale.encounters', 'happywhale.users', 'happywhale.individuals', 'happywhale.species', 'happywhale.media'],
    native: ['public.observations', 'public.observation_photos', 'public.contributors'],
    orcasound: ['orcasound.bouts', 'orcasound.bout_entities'],
};

/**
 * Which arms to recompute for the inputs the build says changed, in SOURCES order — or
 * every arm, and why: no list (no basis: the first run, a code change, an output missing or
 * rewritten), an empty one, or a changed input no single arm claims.
 */
export type Arms = {arms: readonly Source[]} | {all: string};
export function armsFor(changed: readonly string[] | null): Arms {
    if (changed === null) return {all: 'no list of changed inputs'};
    if (changed.length === 0) return {all: 'an empty list of changed inputs'};
    const stray = changed.find(input => !SOURCES.some(s => ARM_INPUTS[s].includes(input)));
    if (stray !== undefined) return {all: `${stray} is read by every arm, or unknown here`};
    const arms = new Set(changed.map(input => SOURCES.find(s => ARM_INPUTS[s].includes(input))!));
    return {arms: SOURCES.filter(s => arms.has(s))};
}

/**
 * occurrences.sql in its parts: the comment preamble, one section per arm (its view, and
 * the macro happywhale's needs), and the shared tail (the build schema and the document
 * macro). Marked in the file with `-- arm: <source>` and `-- shared` lines, so the script
 * runs the shared part first and then each arm it re-derives, and no other: DuckDB binds
 * a view's tables at CREATE, so an arm's view must follow the memory tables its arm
 * resolves into (writeMaplifyEntities, writeInaturalistOutOfScope), which an arm left
 * alone never writes.
 */
export function parseArms(sql: string): {preamble: string, arms: Record<Source, string>, shared: string} {
    const parts = sql.split(/^-- (arm: \w+|shared)$/m);
    const preamble = parts[0]!;
    // the preamble is never run, so it may hold nothing that would need running
    for (const line of preamble.split('\n'))
        if (line.trim() !== '' && !line.trimStart().startsWith('--'))
            throw new Error(`occurrences.sql: a statement before the first '-- arm:' marker would never run: ${line.trim()}`);
    const arms: Partial<Record<Source, string>> = {};
    let shared: string | undefined;
    for (let i = 1; i < parts.length; i += 2) {
        const marker = parts[i]!, body = parts[i + 1] ?? '';
        if (marker === 'shared') shared = body;
        else {
            const source = marker.slice('arm: '.length) as Source;
            if (!SOURCES.includes(source)) throw new Error(`occurrences.sql: unknown arm '${source}'`);
            if (arms[source] !== undefined) throw new Error(`occurrences.sql: '-- arm: ${source}' twice`);
            arms[source] = body;
        }
    }
    for (const source of SOURCES) if (arms[source] === undefined) throw new Error(`occurrences.sql: no '-- arm: ${source}' section`);
    if (shared === undefined) throw new Error("occurrences.sql: no '-- shared' section");
    return {preamble, arms: arms as Record<Source, string>, shared};
}

/** The build's list of changed inputs, newline-separated; null when it said nothing. */
export function changedInputs(env: NodeJS.ProcessEnv = process.env): string[] | null {
    const raw = env['STELIS_CHANGED_INPUTS'];
    if (raw === undefined) return null;
    return raw.split('\n').map(s => s.trim()).filter(Boolean);
}

/**
 * The table's columns, each with its type and the expression an arm's view supplies it
 * from — one list, so the CREATE TABLE and the INSERTs cannot disagree.
 */
const COLUMNS: readonly {name: string, type: string, from: (source: Source) => string}[] = [
    {name: 'id', type: 'VARCHAR', from: () => 'id'},
    {name: 'observed_at', type: 'TIMESTAMPTZ', from: () => 'observed_at'},
    {name: 'doc', type: 'VARCHAR', from: () => 'occurrence_doc(o)'},
    {name: 'source', type: 'VARCHAR', from: source => `'${source}'`},
    {name: 'identifiers', type: 'VARCHAR[]', from: () => 'identifiers'},
    {name: 'location', type: 'STRUCT(lat DOUBLE, lon DOUBLE)', from: () => 'location'},
];
const CREATE_TABLE = `CREATE OR REPLACE TABLE build.occurrences (${COLUMNS.map(c => `${c.name} ${c.type}`).join(', ')})`;
const insertArm = (source: Source) =>
    `INSERT INTO build.occurrences SELECT ${COLUMNS.map(c => c.from(source)).join(', ')} FROM ${source}_occurrences o`;

export async function deriveOccurrences(snapshot: string, mirrors: Mirrors,
    changed: readonly string[] | null = changedInputs()): Promise<{rows: number, arms: readonly Source[] | 'all'}> {
    const extract = await readFile(new URL('./derive/extract.sql', import.meta.url), 'utf8');
    const shared = await readFile(new URL('./derive/shared.sql', import.meta.url), 'utf8');
    const lookups = await readFile(new URL('./derive/lookups.sql', import.meta.url), 'utf8');
    const maplifyCollection = await readFile(new URL('./derive/maplify-collection.sql', import.meta.url), 'utf8');
    const sql = await readFile(new URL('./derive/occurrences.sql', import.meta.url), 'utf8');
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        // Capped, as snapshot.ts is, for the 1 GB Fly machine: what doesn't fit spills
        // beside the snapshot. Measured on 63,720 occurrences: it runs out at 64 MB and
        // completes at 96; at 128 the process peaks at 324 MB on macOS, of which about
        // 115 is node and DuckDB before any query. Running out fails this task, loudly,
        // which is the failure to want here, rather than the machine thrashing.
        await budget(conn, snapshot, '128MB');
        // Postgres's session: timestamps rendered in UTC, text sorted by ICU's en-US.
        await conn.run(`INSTALL icu; LOAD icu; SET TimeZone = 'UTC'`);
        // The table's row order means nothing (readers order by observed_at and id),
        // and keeping it would make DuckDB buffer the result.
        await conn.run('SET preserve_insertion_order = false');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store`);
        await conn.run('USE store');
        await attachSources(conn, mirrors);
        await conn.run(extract);
        await conn.run(shared);
        await conn.run(lookups);
        await conn.run(maplifyCollection);
        const parts = parseArms(sql);
        await conn.run(parts.shared);
        const wanted = armsFor(changed);
        // Stelis gives the list only when the last run's table is intact (ADR 0015); a hand
        // run with the variable set on a fresh snapshot has no table to replace into, so
        // whatever it was told, every arm is written. (Ingest builds are told too, and
        // today always re-derive every arm: iNaturalist's taxa, which every arm names
        // species through, are restamped a few at a time each run.)
        const present = Number((await conn.runAndReadAll(
            `SELECT count(*) FROM information_schema.tables
             WHERE table_catalog = 'store' AND table_schema = 'build' AND table_name = 'occurrences'`,
        )).getRows()[0]![0]) > 0;
        // Told, but every arm goes anyway: say why, since the engine's own line lists
        // what changed and the two are read side by side.
        const chosen: Arms = !present ? {all: 'no table yet to replace into'} : wanted;
        if (changed !== null && 'all' in chosen)
            console.log(`build.occurrences: told ${changed.length} input(s) changed, re-deriving every arm: ${chosen.all}`);
        const all = 'all' in chosen;
        const arms: readonly Source[] = all ? SOURCES : chosen.arms;
        // Each arm's view, after the memory tables it binds to (writeMaplifyEntities,
        // writeInaturalistOutOfScope), and all of it BEFORE any transaction below: a DuckDB
        // transaction may write one attached database, and these write `memory`, while
        // the rows go to the store.
        for (const source of arms) {
            if (source === 'maplify') await writeMaplifyEntities(conn);
            if (source === 'inaturalist') await writeInaturalistOutOfScope(conn);
            await conn.run(parts.arms[source]);
        }
        // A full run REPLACES the table, so a column added here reaches the file on the
        // volume; a partial one replaces its arms' rows in place.
        if (all) await conn.run(CREATE_TABLE);
        // One transaction PER ARM, as the one-INSERT-per-source design always was: only one
        // source's joins and photo lists are held uncommitted at once, which is what the
        // 128 MB budget was measured against. A failure in an arm — the budget running out,
        // a refused direction — rolls that arm back; the task then fails, the build's
        // receipt no longer matches the table, and the next run re-derives everything.
        for (const source of arms) {
            await conn.run('BEGIN');
            try {
                if (!all) await conn.run(`DELETE FROM build.occurrences WHERE source = '${source}'`);
                await conn.run(insertArm(source));
                // Postgres casts the extracted direction to its enum and fails on anything
                // else; the pattern can only yield these eight, so this is the cast's
                // refusal, kept — over the rows just written, before they are committed.
                const odd = await conn.runAndReadAll(`
                    SELECT count(*) FROM (
                      SELECT json_extract_string(doc, '$.direction') AS direction
                      FROM build.occurrences WHERE source = '${source}')
                    WHERE direction IS NOT NULL AND direction NOT IN
                      ('north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest')`);
                if (Number(odd.getRows()[0]![0]) > 0) throw new Error(`extract_travel_direction answered outside the enum (${source})`);
                await conn.run('COMMIT');
            } catch (error) {
                // the failure is the thing to report; a rollback that fails too (a connection
                // the failure already invalidated) must not replace it
                try { await conn.run('ROLLBACK'); } catch (rollback) { console.error('rollback failed too:', rollback); }
                throw error;
            }
        }
        // Rows replaced in place leave dead rows in the file until a checkpoint compacts
        // them; a save every half-minute would otherwise grow the snapshot on the volume.
        if (!all) await conn.run('CHECKPOINT store');
        const reader = await conn.runAndReadAll('SELECT count(*) FROM build.occurrences');
        return {rows: Number(reader.getRows()[0]![0]), arms: all ? 'all' : arms};
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}

export async function main(): Promise<void> {
    const [snapshot, ...rest] = process.argv.slice(2);
    const mirrors = mirrorArgs(rest);
    if (!snapshot || !mirrors) {
        console.error('usage: derive-occurrences.ts <snapshot.duckdb> <maplify.sqlite> <inaturalist.sqlite> <orcasound.sqlite>');
        process.exit(2);
    }
    const {rows, arms} = await deriveOccurrences(snapshot, mirrors);
    console.log(`build.occurrences: ${rows} rows${arms === 'all' ? '' : ` (${arms.join(', ')} re-derived; the rest as they were)`}`);
}

if (import.meta.main) {
    await main();
}
