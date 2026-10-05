/**
 * The animals register, fetched by the read-path build itself (decision 064, salish-9uu.2.2),
 * as it fetches Maplify, iNaturalist and Orcasound.
 *
 *   node scripts/read-path/ingest-register.ts <snapshot.duckdb> <maplify.sqlite> --allow <maplify-unnamed.tsv> [--tag <tag>]
 *
 * Each run asks which release is newest — the tag GitHub's `releases/latest` redirects to,
 * one request with nothing downloaded — and stops there if the build already holds it. A
 * new edition is fetched and verified against its SHA256SUMS by the same code the Postgres
 * loader uses (register/edition.ts), then written into the snapshot database under the
 * names Postgres's copy had (`register.entities` and the rest), typed as the snapshot read
 * them, so the derivation reads them unchanged; `register.edition` records which.
 *
 * An edition that would un-name a Maplify sighting is refused BEFORE it is adopted, as
 * register-refresh.yml refuses it before loading Postgres (salish-xv35.9.2): the build keeps
 * the edition it has, the run is recorded as failed with the pairs named, and the heartbeat
 * says so. The question is the workflow's, asked of different evidence: every (name,
 * scientific name) pair the Maplify mirror holds, resolved by the edition the build holds
 * and by the new one. The workflow judges against the name guard's published baseline,
 * which a task downstream of this one writes, so reading it here would be a cycle; the guard
 * (check-maplify-names.ts) stays as the backstop for what this misses, a pair the mirror
 * doesn't hold this run. A curator accepts an un-naming in data/maplify-unnamed.tsv.
 *
 * `--tag`, or REGISTER_TAG in the environment (how an operator sets it on the Fly machine),
 * holds the build at, or rolls it back to, one edition, as the workflow's input does.
 * Under Stelis it writes the boundary receipt (STELIS_BOUNDARY_RECEIPT).
 */

import { rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';

import { resolveEntity, type NormalizedSighting } from '../ingest/maplify.ts';
import { isRetryableStatus, markTransientUpstream } from '../ingest/retry.ts';
import { checkEdition } from '../register/check-unnaming.ts';
import { fetchEdition, REPO } from '../register/edition.ts';
import { buildNameIndex, NAME_INDEX_SQL, type RegisterName } from '../register/name-index.ts';
import { readUnnamed } from '../register/unnamed.ts';
import type { Named } from './check-maplify-names.ts';
import { budget } from './duckdb-budget.ts';
import { boundaryReceipt, recordedRun } from './ingest-runs.ts';

/**
 * The register tables the build reads, the columns of each it reads, and where each lives in
 * the published tarball — for the first six, the snapshot's own selection from Postgres, so
 * the switch moved no digest. `depth` is the one column Postgres types; the rest are text
 * there and here. `file` names the tarball's file when the table is a selection under
 * another name.
 */
export const REGISTER_TABLES: readonly {table: string, dir: 'data' | 'dist', file?: string, select: string}[] = [
    {table: 'entities', dir: 'data', select: 'entity_id, kind, label'},
    {table: 'names', dir: 'data', select: 'entity_id, name, type, language'},
    {table: 'mappings', dir: 'data', select: 'subject_id, predicate_id, object_id'},
    {table: 'ancestor', dir: 'dist', select: 'entity_id, ancestor_id, CAST(depth AS INTEGER) AS depth, ancestor_kind'},
    {table: 'deprecations', dir: 'data', select: 'entity_id, replaced_by'},
    {table: 'classification', dir: 'dist', select:
        'entity_id, label, taxon_id, scientific_name, taxon_rank, kingdom, phylum, class, "order", family, genus'},
    // What an individual's sex, birth years and life status are derived from (decision 051,
    // salish-9uu.2.3): Postgres copied them onto public.individuals on every load
    // (refresh_individual_vitals); the build's catalogue derives them (catalogue.ts).
    {table: 'vitals', dir: 'data', file: 'entities', select: 'entity_id, sex, born'},
    {table: 'current_status', dir: 'dist', select: 'entity_id, status'},
];

/** The tag `releases/latest` redirects to: one request, nothing downloaded. */
export async function latestTag(): Promise<string> {
    let res: Response;
    try {
        res = await fetch(`https://github.com/${REPO}/releases/latest`, {
            redirect: 'manual',
            headers: {'User-Agent': 'salishsea.io read-path build'},
            signal: AbortSignal.timeout(30_000),
        });
    } catch (error) {
        // no connection or a timeout: GitHub's side, or the network's, not ours (decision 042)
        throw markTransientUpstream(error);
    }
    const location = res.headers.get('location');
    const tag = location?.match(/\/releases\/tag\/([^/?#]+)$/)?.[1];
    if (!tag) {
        const error = new Error(`releases/latest answered ${res.status} without a release tag`);
        throw isRetryableStatus(res.status) ? markTransientUpstream(error) : error;
    }
    return decodeURIComponent(tag);
}

async function tableExists(conn: DuckDBConnection, schema: string, table: string): Promise<boolean> {
    const r = await conn.runAndReadAll(
        `SELECT count(*) FROM information_schema.tables WHERE table_catalog = 'store' AND table_schema = '${schema}' AND table_name = '${table}'`,
    );
    return Number(r.getRows()[0]![0]) > 0;
}

/**
 * What the edition the build holds names each pair the Maplify mirror holds: the baseline a
 * new edition is judged against. Empty when the build holds no register yet.
 */
async function heldNames(conn: DuckDBConnection): Promise<Named[]> {
    if (!(await tableExists(conn, 'register', 'entities'))) return [];
    const index = buildNameIndex((await conn.runAndReadAll(NAME_INDEX_SQL)).getRowObjectsJS() as unknown as RegisterName[]);
    const pairs = (await conn.runAndReadAll(
        'SELECT DISTINCT name, scientific_name FROM maplify_mirror.sightings',
    )).getRowObjectsJS() as unknown as {name: string | null, scientific_name: string}[];
    return pairs.flatMap(p => {
        // resolveEntity reads only these two of a sighting's fields.
        const entity_id = resolveEntity({name: p.name, scientificName: p.scientific_name} as NormalizedSighting, index);
        return entity_id ? [{...p, entity_id}] : [];
    });
}

/** Write an unpacked edition's tables into the snapshot, and which edition it is, at once. */
async function adopt(conn: DuckDBConnection, dir: string, tag: string, digest: string): Promise<number> {
    await conn.run('CREATE SCHEMA IF NOT EXISTS store.register');
    await conn.run('BEGIN');
    let rows = 0;
    for (const {table, dir: sub, file: name, select} of REGISTER_TABLES) {
        const file = path.join(dir, sub, `${name ?? table}.tsv`).replaceAll("'", "''");
        // the register's TSVs carry no quoting, and an empty cell is NULL (edition.ts)
        await conn.run(`CREATE OR REPLACE TABLE store.register.${table} AS SELECT ${select}
            FROM read_csv('${file}', delim = '\t', header = true, quote = '', escape = '', nullstr = '', all_varchar = true)`);
        rows += Number((await conn.runAndReadAll(`SELECT count(*) FROM store.register.${table}`)).getRows()[0]![0]);
    }
    await conn.run(`CREATE OR REPLACE TABLE store.register.edition AS
        SELECT '${tag.replaceAll("'", "''")}' AS tag, '${digest}' AS sha256`);
    await conn.run('COMMIT');
    return rows;
}

export async function main(): Promise<void> {
    const args = process.argv.slice(2);
    function usage(): never {
        console.error('usage: ingest-register.ts <snapshot.duckdb> <maplify.sqlite> --allow <maplify-unnamed.tsv> [--tag <tag>]');
        process.exit(2);
    }
    // An option's value is the next argument, and never another option.
    const option = (name: string): string | undefined => {
        const at = args.indexOf(name);
        if (at < 0) return undefined;
        const value = args[at + 1];
        if (value === undefined || value.startsWith('--')) usage();
        args.splice(at, 2);
        return value;
    };
    const allow = option('--allow');
    const pinned = option('--tag') ?? (process.env['REGISTER_TAG'] || undefined);
    const [snapshot, mirror] = args;
    if (!snapshot || !mirror || !allow || args.length !== 2) usage();
    const say = (msg: string) => console.log(msg);

    const run = await recordedRun(mirror, 'register', pinned ? 'manual' : 'cron', async () => {
        const tag = pinned ?? await latestTag();
        const db = await DuckDBInstance.create(':memory:');
        const conn = await db.connect();
        try {
            await budget(conn, snapshot, '64MB');
            await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store`);
            await conn.run('USE store');
            const held = await tableExists(conn, 'register', 'edition')
                ? (await conn.runAndReadAll('SELECT tag FROM register.edition')).getRows()[0]?.[0] as string | undefined
                : undefined;
            // A table this version of the build reads that the last didn't is missing from the
            // edition it holds: adopt that edition again first, whatever is newest, so a newer
            // edition being refused can't leave the build without it (Fable review).
            const missing: string[] = [];
            for (const {table} of REGISTER_TABLES)
                if (!(await tableExists(conn, 'register', table))) missing.push(table);
            let restored = 0;
            if (held && missing.length > 0) {
                say(`register ${held}: held, but without ${missing.join(', ')}; adopting it again`);
                const again = await fetchEdition(held, () => {});
                try {
                    restored = await adopt(conn, again.dir, held, again.digest);
                } finally {
                    rmSync(again.dir, {recursive: true, force: true});
                }
            }
            if (held === tag) {
                if (!restored) say(`register ${tag}: held already`);
                return restored;
            }
            await conn.run('INSTALL sqlite; LOAD sqlite');
            await conn.run(`ATTACH '${mirror.replaceAll("'", "''")}' AS maplify_mirror (TYPE sqlite, READ_ONLY)`);
            const baseline = await heldNames(conn);
            const {digest, dir} = await fetchEdition(tag, () => {});
            try {
                const unnamed = await checkEdition(dir, baseline, readUnnamed(allow));
                if (unnamed.length > 0) {
                    const pairs = unnamed.map(u => `${u.name ?? '(no name)'} / ${u.scientific_name} (was ${u.was})`);
                    // Recorded, published in the run log, and the heartbeat's to raise; the
                    // build goes on with the edition it holds.
                    throw new Error(`register ${tag} refused: it un-names ${unnamed.length} Maplify `
                        + `pair(s) ${held ? `edition ${held} names` : 'the held register names'}: ${pairs.join('; ')}. `
                        + 'Accept in data/maplify-unnamed.tsv, or fix the register.');
                }
                const rows = await adopt(conn, dir, tag, digest);
                say(`register ${tag}: adopted (${held ? `was ${held}` : 'no edition held before'}), ${rows} rows`);
                return rows;
            } finally {
                rmSync(dir, {recursive: true, force: true});
            }
        } finally {
            conn.closeSync();
            db.closeSync();
        }
    });
    if (!run.ok) console.log(`register: ${run.error instanceof Error ? run.error.message : String(run.error)}`);
    const receipt = process.env['STELIS_BOUNDARY_RECEIPT'];
    if (receipt) await writeFile(receipt, boundaryReceipt(run, null));
}

if (import.meta.main) {
    await main();
}
