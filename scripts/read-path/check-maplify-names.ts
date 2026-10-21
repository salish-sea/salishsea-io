/**
 * Does the register still name every Maplify sighting a passing build named? (salish-xv35.9)
 *
 *   node scripts/read-path/check-maplify-names.ts <snapshot.duckdb> <maplify.sqlite> \
 *     --baseline data/maplify-names.json [--allow data/maplify-unnamed.tsv]
 *
 * The build resolves a Maplify sighting's animal from the register it was given
 * (derive/maplify-entities.ts), so a register edition that loses a name would quietly
 * drop every sighting that used it from the map: renaming one register name dropped 30.
 * Postgres's ingest refused that (resolve-maplify.ts exits non-zero rather than take an
 * identification away); this is the build's own refusal. A gate before the derivation,
 * so a failure leaves the last good files published.
 *
 * It asks the build's own rule, resolveEntity over the snapshot's register, about every
 * (name, scientific name) pair the Maplify mirror holds, and compares the answers with
 * the baseline: every pair a passing build has named, and to what, checked in as
 * data/maplify-names.json (decision 083). A pair that was named and now resolves to
 * nothing fails the build, naming it, so the build keeps failing until the register names
 * it again, as Postgres's refusal did. A pair moving to another entity is a register edit
 * doing its job.
 *
 * On a pass it writes what the baseline should become, this build's answers plus the
 * named pairs the mirror doesn't hold at the moment, as a report beside the mirrors,
 * served as /status/maplify-names.json. The report is derived, rewritten by every pass;
 * the baseline changes only by a pull request, which refresh-maplify-names.ts prepares
 * from the report. A new pair is guarded once it is in the checked-in file; until then
 * the register fetch's own refusal (ingest-register.ts) covers it for as long as the
 * mirror holds it. Until decision 083 the baseline was this file on the volume, which
 * each pass rewrote and nothing could regenerate.
 *
 * No baseline file is a configuration error, not an empty baseline: the build must not
 * run unguarded because a path was wrong.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { resolveEntity, type NormalizedSighting } from '../ingest/maplify.ts';
import { buildNameIndex, NAME_INDEX_SQL, type RegisterName } from '../register/name-index.ts';
import { pairKey, readUnnamed } from '../register/unnamed.ts';
import { budget } from './duckdb-budget.ts';

/** A (name, scientific name) pair and the entity it resolves to. */
export type Named = {name: string | null, scientific_name: string, entity_id: string};
export type Unnamed = {name: string | null, scientific_name: string, was: string, sightings: number};
type Pair = {name: string | null, scientific_name: string, entity_id: string | null, sightings: number};

const key = pairKey;

/**
 * The pairs that were named and now resolve to nothing, and what the baseline becomes if
 * there are none: every pair named now, and every named pair the mirror doesn't hold at
 * the moment, carried forward, so a pair that leaves and comes back unnamed is still
 * caught. A pair a curator has accepted as un-named (`allowed`, data/maplify-unnamed.tsv)
 * is nobody's loss: it leaves the baseline, and comes back only if it resolves again.
 * Pure.
 */
export function judge(
    baseline: readonly Named[], current: readonly Pair[], allowed: ReadonlySet<string> = new Set(),
): {unnamed: Unnamed[], next: Named[]} {
    baseline = baseline.filter(b => !allowed.has(key(b)));
    const now = new Map(current.map(p => [key(p), p]));
    const unnamed = baseline.flatMap(b => {
        const p = now.get(key(b));
        return p && p.entity_id === null
            ? [{name: b.name, scientific_name: b.scientific_name, was: b.entity_id, sightings: p.sightings}]
            : [];
    }).sort((a, b) => b.sightings - a.sightings);
    const next = [
        ...current.flatMap(p => p.entity_id === null ? []
            : [{name: p.name, scientific_name: p.scientific_name, entity_id: p.entity_id}]),
        ...baseline.filter(b => !now.has(key(b))),
    ].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0);
    return {unnamed, next};
}

/**
 * A baseline, or a report of what one should become, from a file or a URL: the checked-in
 * data/maplify-names.json, or the served /status/maplify-names.json. The same shape
 * either way, so check-unnaming.ts and refresh-maplify-names.ts read both with this.
 */
export async function readBaseline(source: string): Promise<Named[]> {
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

/** Where a pass writes what the baseline should become: beside the Maplify mirror. */
export const reportFile = (mirror: string) => join(dirname(mirror), 'maplify-names.json');

/** Check the mirror's pairs against the checked-in baseline; on a pass, write the report. */
export async function checkNames(snapshot: string, mirror: string, baselineFile: string, allow?: string): Promise<Unnamed[]> {
    const allowed = readUnnamed(allow);
    let baseline: Named[];
    try {
        baseline = await readBaseline(baselineFile);
    } catch (e) {
        throw new Error(`the name guard's baseline could not be read from ${baselineFile}: ${(e as Error).message}`, {cause: e});
    }
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    let current: Pair[];
    try {
        await budget(conn, snapshot, '64MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        await conn.run('USE store');
        await conn.run('INSTALL sqlite; LOAD sqlite');
        await conn.run(`ATTACH '${mirror.replaceAll("'", "''")}' AS maplify_mirror (TYPE sqlite, READ_ONLY)`);
        const index = buildNameIndex((await conn.runAndReadAll(NAME_INDEX_SQL)).getRowObjectsJS() as unknown as RegisterName[]);
        const pairs = (await conn.runAndReadAll(`
            SELECT name, scientific_name, CAST(count(*) AS INTEGER) AS sightings
            FROM maplify_mirror.sightings
            GROUP BY name, scientific_name`)).getRowObjectsJS() as unknown as Omit<Pair, 'entity_id'>[];
        // resolveEntity reads only these two of a sighting's fields.
        current = pairs.map(p => ({
            ...p, entity_id: resolveEntity({name: p.name, scientificName: p.scientific_name} as NormalizedSighting, index),
        }));
    } finally {
        conn.closeSync();
        db.closeSync();
    }
    const {unnamed, next} = judge(baseline, current, allowed);
    if (unnamed.length === 0) {
        const file = reportFile(mirror);
        const temp = `${file}.${process.pid}.tmp`;
        writeFileSync(temp, `${JSON.stringify({pairs: next}, null, 1)}\n`);
        renameSync(temp, file);
    }
    return unnamed;
}

export async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const option = (flag: string) => {
        const at = args.indexOf(flag);
        const value = at >= 0 ? args[at + 1] : undefined;
        if (at >= 0) args.splice(at, 2);
        return value;
    };
    const baseline = option('--baseline');
    const allow = option('--allow');
    const [snapshot, mirror] = args;
    if (!snapshot || !mirror || !baseline) {
        console.error('usage: check-maplify-names.ts <snapshot.duckdb> <maplify.sqlite> --baseline <maplify-names.json> [--allow <maplify-unnamed.tsv>]');
        process.exit(2);
    }
    const unnamed = await checkNames(snapshot, mirror, baseline, allow);
    if (unnamed.length === 0) {
        console.log('every Maplify name the baseline resolves still resolves');
        return;
    }
    const total = unnamed.reduce((n, u) => n + u.sightings, 0);
    console.error(`the register no longer names ${total} Maplify sightings the baseline names:`);
    for (const u of unnamed)
        console.error(`  ${JSON.stringify(u.name)} / ${JSON.stringify(u.scientific_name)} (was ${u.was}): ${u.sightings}`);
    process.exit(1);
}

if (import.meta.main) {
    await main();
}
