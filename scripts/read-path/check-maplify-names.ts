/**
 * Does the register still name every Maplify sighting the last build named? (salish-xv35.9)
 *
 *   node scripts/read-path/check-maplify-names.ts <snapshot.duckdb> <maplify.sqlite>
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
 * the last passing build's, kept beside the mirrors in maplify-names.json. A pair that
 * was named and now resolves to nothing fails the build, naming it; the baseline is then
 * left as it was, so the build keeps failing until the register names it again, as
 * Postgres's refusal did. A pair moving to another entity is a register edit doing its
 * job. On a pass the baseline becomes this build's answers, keeping the named pairs the
 * mirror doesn't hold at the moment.
 *
 * Before the first pass there is no baseline file, and the first pass seeds it with this
 * build's answers (until 2026-10-05 Postgres's stored answer stood in, while its own
 * ingest still resolved Maplify); the build's register fetch refuses an edition that
 * would un-name a pair the mirror holds before adopting it, so this gate is the backstop.
 *
 * The baseline is operational state outside the graph, like the ingest run log: the
 * gate's inputs are the register and the mirror, and a build whose inputs are unchanged
 * has nothing new to judge.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
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

/** Where the last passing build's answers are kept: beside the Maplify mirror. */
export const baselineFile = (mirror: string) => join(dirname(mirror), 'maplify-names.json');

/** Check the mirror's pairs against the baseline; on a pass, write the new baseline. */
export async function checkNames(snapshot: string, mirror: string, allow?: string): Promise<Unnamed[]> {
    const allowed = readUnnamed(allow);
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    let current: Pair[];
    let baseline: Named[];
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
        baseline = existsSync(baselineFile(mirror))
            ? (JSON.parse(readFileSync(baselineFile(mirror), 'utf8')) as {pairs: Named[]}).pairs
            : [];
    } finally {
        conn.closeSync();
        db.closeSync();
    }
    const {unnamed, next} = judge(baseline, current, allowed);
    if (unnamed.length === 0) {
        const file = baselineFile(mirror);
        const temp = `${file}.${process.pid}.tmp`;
        writeFileSync(temp, `${JSON.stringify({pairs: next}, null, 1)}\n`);
        renameSync(temp, file);
    }
    return unnamed;
}

export async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const at = args.indexOf('--allow');
    const allow = at >= 0 ? args[at + 1] : undefined;
    if (at >= 0) args.splice(at, 2);
    const [snapshot, mirror] = args;
    if (!snapshot || !mirror || (at >= 0 && !allow)) {
        console.error('usage: check-maplify-names.ts <snapshot.duckdb> <maplify.sqlite> [--allow <maplify-unnamed.tsv>]');
        process.exit(2);
    }
    const unnamed = await checkNames(snapshot, mirror, allow);
    if (unnamed.length === 0) {
        console.log('every Maplify name the last build resolved still resolves');
        return;
    }
    const total = unnamed.reduce((n, u) => n + u.sightings, 0);
    console.error(`the register no longer names ${total} Maplify sightings the last build named:`);
    for (const u of unnamed)
        console.error(`  ${JSON.stringify(u.name)} / ${JSON.stringify(u.scientific_name)} (was ${u.was}): ${u.sightings}`);
    process.exit(1);
}

if (import.meta.main) {
    await main();
}
