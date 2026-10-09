/**
 * Would this register edition un-name any Maplify sighting the map shows? Asked BEFORE
 * the edition is adopted (salish-xv35.9.2), so that an edition which would is refused —
 * the build keeps the edition it has (read-path/ingest-register.ts) — rather than adopted
 * and then regretted. An input that would leave us inconsistent is rejected at the door.
 * The command line below asks the same question of a candidate edition by hand.
 *
 *   pnpm exec tsx scripts/register/check-unnaming.ts --tag 2026.10.1 \
 *     --baseline https://salishsea.io/status/maplify-names.json \
 *     --allow data/maplify-unnamed.tsv
 *
 * The baseline is the read-path build's own: every (name, scientific name) pair its
 * Maplify mirror holds and the entity the build resolved it to, published from the build
 * machine. The build's gate (read-path/check-maplify-names.ts) judges each build against
 * the same file with the same rule, and stays as the backstop for an edition that reached
 * Postgres without passing here (a hand `--emit-sql` load). Both read the same allow-list.
 *
 * The edition is read the way the build reads a register: its TSVs into DuckDB, the
 * name index by NAME_INDEX_SQL, resolveEntity over each pair. One rule, three readers.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { resolveEntity, type NormalizedSighting } from '../ingest/maplify.ts';
import { judge, type Named, type Unnamed } from '../read-path/check-maplify-names.ts';
import { fetchEdition } from './edition.ts';
import { buildNameIndex, NAME_INDEX_SQL, type RegisterName } from './name-index.ts';
import { readUnnamed } from './unnamed.ts';

/** The four tables the name index reads, as DuckDB reads them off an unpacked edition. */
const INDEX_TABLES: readonly [subdir: string, name: string, select: string][] = [
    ['data', 'entities', 'entity_id, kind, label'],
    ['data', 'names', 'entity_id, name, type, language'],
    ['dist', 'ancestor', 'entity_id, ancestor_id, CAST(depth AS INTEGER) AS depth, ancestor_kind'],
    ['data', 'deprecations', 'entity_id, replaced_by'],
];

/** What an unpacked edition names each baseline pair; `judge` says which it un-names. */
export async function checkEdition(
    dir: string, baseline: readonly Named[], allowed: ReadonlySet<string>,
): Promise<Unnamed[]> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await conn.run("SET memory_limit = '256MB'; SET threads = 1");
        await conn.run('CREATE SCHEMA register');
        for (const [subdir, name, select] of INDEX_TABLES) {
            const file = path.join(dir, subdir, `${name}.tsv`).replaceAll("'", "''");
            // the register's TSVs carry no quoting, and an empty cell is NULL (edition.ts)
            await conn.run(`CREATE TABLE register.${name} AS SELECT ${select}
                FROM read_csv('${file}', delim = '\t', header = true, quote = '', escape = '', nullstr = '', all_varchar = true)`);
        }
        const index = buildNameIndex((await conn.runAndReadAll(NAME_INDEX_SQL)).getRowObjectsJS() as unknown as RegisterName[]);
        const current = baseline.map(p => ({
            name: p.name, scientific_name: p.scientific_name, sightings: 0,
            entity_id: resolveEntity({name: p.name, scientificName: p.scientific_name} as NormalizedSighting, index),
        }));
        return judge(baseline, current, allowed).unnamed;
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}

async function readBaseline(source: string): Promise<Named[]> {
    const text = /^https?:\/\//.test(source)
        ? await (async () => {
            const res = await fetch(source, {signal: AbortSignal.timeout(30_000)});
            if (!res.ok) throw new Error(`${res.status} fetching ${source}`);
            return res.text();
        })()
        : readFileSync(source, 'utf8');
    const parsed = JSON.parse(text) as {pairs?: unknown};
    if (!Array.isArray(parsed.pairs)) throw new Error(`${source}: not a baseline ({pairs: [...]})`);
    return parsed.pairs as Named[];
}

async function main(): Promise<void> {
    const argv = process.argv;
    const option = (flag: string) => {
        const at = argv.indexOf(flag);
        const value = at >= 0 ? argv[at + 1] : undefined;
        return value === undefined || value.startsWith('--') ? undefined : value;
    };
    const tag = option('--tag');
    const baselineSource = option('--baseline');
    if (!tag || !baselineSource) {
        console.error('usage: check-unnaming.ts --tag <release> --baseline <url|file> [--allow <maplify-unnamed.tsv>]');
        process.exit(2);
    }
    const allowed = readUnnamed(option('--allow'));
    const baseline = await readBaseline(baselineSource);
    console.log(`baseline: ${baseline.length} named pairs from ${baselineSource}; ${allowed.size} accepted as un-named`);
    const {dir} = await fetchEdition(tag, console.log);
    let unnamed: Unnamed[];
    try {
        unnamed = await checkEdition(dir, baseline, allowed);
    } finally {
        rmSync(dir, {recursive: true, force: true});
    }
    if (unnamed.length === 0) {
        console.log(`${tag} still names every pair the map shows`);
        return;
    }
    console.error(`REFUSING ${tag}: it no longer names ${unnamed.length} pair(s) the map shows. Not loaded.`);
    for (const u of unnamed)
        console.error(`  ${JSON.stringify(u.name)} / ${JSON.stringify(u.scientific_name)} (was ${u.was})`);
    console.error('To accept an un-naming on purpose, add the pair to data/maplify-unnamed.tsv first.');
    process.exit(1);
}

if (import.meta.main) {
    main().catch((err: unknown) => {
        console.error(err);
        process.exit(1);
    });
}
