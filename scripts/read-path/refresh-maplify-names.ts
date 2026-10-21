/**
 * Bring the name guard's checked-in baseline (data/maplify-names.json, decision 083) up to
 * what the build last reported.
 *
 *   node scripts/read-path/refresh-maplify-names.ts [<report, a path or URL>]
 *
 * The build judges every Maplify (name, scientific name) pair against the checked-in
 * baseline (check-maplify-names.ts) and, on a pass, publishes what the baseline should
 * become at https://salishsea.io/status/maplify-names.json: the pairs it named this
 * build, plus the named pairs the mirror no longer holds, minus the ones a curator has
 * accepted as un-named. A new pair is guarded only once it is in the checked-in file, so
 * this copies the report over it and says what changed; the commit is a pull request's,
 * where the change is reviewed like any other.
 */

import { writeFileSync } from 'node:fs';

import { pairKey } from '../register/unnamed.ts';
import { type Named, readBaseline } from './check-maplify-names.ts';

export const BASELINE = 'data/maplify-names.json';
const REPORT = 'https://salishsea.io/status/maplify-names.json';

/** One line per pair that is added, dropped, or now resolves elsewhere. Pure. */
export function describeChange(before: readonly Named[], after: readonly Named[]): string[] {
    const was = new Map(before.map(p => [pairKey(p), p]));
    const now = new Map(after.map(p => [pairKey(p), p]));
    const show = (p: Named) => `${JSON.stringify(p.name)} / ${JSON.stringify(p.scientific_name)}`;
    return [
        ...after.filter(p => !was.has(pairKey(p))).map(p => `+ ${show(p)} → ${p.entity_id}`),
        ...before.filter(p => !now.has(pairKey(p))).map(p => `- ${show(p)} (was ${p.entity_id})`),
        ...after.flatMap(p => {
            const b = was.get(pairKey(p));
            return b && b.entity_id !== p.entity_id ? [`~ ${show(p)}: ${b.entity_id} → ${p.entity_id}`] : [];
        }),
    ];
}

export async function main(): Promise<void> {
    const source = process.argv[2] ?? REPORT;
    const before = await readBaseline(BASELINE);
    const after = await readBaseline(source);
    const lines = describeChange(before, after);
    if (lines.length === 0) {
        console.log(`${BASELINE} already holds what ${source} reports (${after.length} pairs)`);
        return;
    }
    writeFileSync(BASELINE, `${JSON.stringify({pairs: after}, null, 1)}\n`);
    console.log(`${BASELINE}: ${before.length} → ${after.length} pairs, from ${source}`);
    for (const line of lines) console.log(`  ${line}`);
    console.log('Commit it in a pull request; the guard covers a pair once it is in the checked-in file.');
}

if (import.meta.main) {
    await main();
}
