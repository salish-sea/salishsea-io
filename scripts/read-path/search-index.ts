/**
 * The site search field's index (GH #640): every animal, matriline, pod, population and
 * haul-out site with a page, and the map's regions, each with the names it answers to.
 *
 *   EXPORT_DIR=… node scripts/read-path/search-index.ts <snapshot.duckdb>
 *
 * Writes $EXPORT_DIR/search-index.json, which the field (src/site-search.ts) fetches the
 * first time someone focuses it, so search works signed out with no database. The shape
 * and the matching are src/search.ts's.
 *
 * An animal answers to every designation it has carried, its nicknames, and the names
 * the register gives it for search (its `historical` and `hidden` names: "SRKW"). It
 * carries its most recent sighting, the newest report its page lists, so the field can
 * offer that as well as the page (Peter, 2026-10-07). That is why this is a task of its
 * own: the profile index cuts off while the catalogue holds still, and the newest
 * report moves with every build that brings one.
 *
 * Only subjects the profile build writes a page for are listed (profiles.ts's filters),
 * so no result points at a page that isn't there.
 */

import { rename, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';

import {
    groupChain, hauloutPath, individualPath, isPopulation, mapUrl, matrilinePath, observedDate, podLabel, podPath,
    POPULATION_KINDS, populationLabel, populationNoun, populationPath, type SocialGroup,
} from '../../src/catalog.ts';
import { REGIONS } from '../../src/constants.ts';
import { fold } from '../../src/fold.ts';
import type { SearchEntry, SearchIndex } from '../../src/search.ts';
import { budget } from './duckdb-budget.ts';
import type { Doc } from './snapshot-tables.ts';

/** What the index is built from, row for row. */
export type Inputs = {
    individuals: Doc[],
    designations: Doc[],
    nicknames: Doc[],
    social_groups: Doc[],
    group_parents: Doc[],
    matriline_members: Doc[],
    haulouts: Doc[],
    /** The register's names for each entity: what it answers to beyond our own codes. */
    names: {entity_id: string, name: string, type: string}[],
    /** Each entity beneath a population group of ours, and that group: an animal in no matriline still has one. */
    populationOf: {entity_id: string, group_id: number}[],
    /** Each subject's newest report its page would list: an individual, a group (matriline or population). */
    latest: {kind: 'individual' | 'group' | 'population', id: number, occurrence_id: string, observed_at: string}[],
};

/** The newest present, unrejected report per subject in one link table (src/catalog.ts's dedupeOccurrenceLinks keeps the same ones). */
const latestIn = (table: string, idColumn: string, kind: string) => `
    SELECT '${kind}' AS kind, CAST(json_extract_string(doc, '$.${idColumn}') AS INTEGER) AS id,
           arg_max(json_extract_string(doc, '$.occurrence_id'), json_extract_string(doc, '$.observed_at')::TIMESTAMPTZ) AS occurrence_id,
           epoch_ms(max(json_extract_string(doc, '$.observed_at')::TIMESTAMPTZ)) AS observed_ms
    FROM store.build.${table}
    WHERE coalesce(json_extract(doc, '$.is_present')::BOOLEAN, true)
      AND json_extract_string(doc, '$.status') IS DISTINCT FROM 'rejected'
    GROUP BY ALL`;

export async function readInputs(snapshot: string): Promise<Inputs> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await budget(conn, snapshot, '64MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        const docs = async (table: string) =>
            ((await conn.runAndReadAll(`SELECT doc FROM store.snapshot.${table}`)).getRows() as [string][]).map(([d]) => JSON.parse(d) as Doc);
        const rows = async <T>(sql: string) => (await conn.runAndReadAll(sql)).getRowObjectsJS() as unknown as T[];
        return {
            individuals: await docs('individuals'),
            designations: await docs('designations'),
            nicknames: await docs('nicknames'),
            social_groups: await docs('social_groups'),
            group_parents: await docs('group_parents'),
            matriline_members: await docs('matriline_members'),
            haulouts: await docs('haulouts'),
            names: await rows(`SELECT entity_id, name, type FROM store.register.names WHERE type IN ('historical', 'hidden')`),
            populationOf: await rows(`
                SELECT a.entity_id, CAST(json_extract_string(g.doc, '$.id') AS INTEGER) AS group_id
                FROM store.register.ancestor a
                JOIN store.snapshot.social_groups g ON json_extract_string(g.doc, '$.entity_id') = a.ancestor_id
                WHERE json_extract_string(g.doc, '$.kind') IN (${POPULATION_KINDS.map(k => `'${k}'`).join(', ')})
                ORDER BY a.entity_id, a.depth`),
            latest: (await rows<Omit<Inputs['latest'][number], 'observed_at'> & {observed_ms: number | bigint}>(`
                ${latestIn('individual_occurrences', 'individual_id', 'individual')}
                UNION ALL ${latestIn('group_occurrences', 'social_group_id', 'group')}
                UNION ALL ${latestIn('ecotype_occurrences', 'ecotype_id', 'population')}`))
                .map(({observed_ms, ...r}) => ({...r, observed_at: new Date(Number(observed_ms)).toISOString()})),
        };
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}

const keysOf = (...names: (string | null | undefined)[]) =>
    [...new Set(names.filter((n): n is string => !!n).map(fold).filter(Boolean))];

/** The index: animals first, then populations, haul-out sites and regions, each in a fixed order. */
export function buildSearchIndex(t: Inputs): SearchIndex {
    const byId = (a: Doc, b: Doc) => a['id'] - b['id'];
    const groups = new Map<number, SocialGroup>(t.social_groups.map(g => [g['id'], {...g, parent_group_id: null} as SocialGroup]));
    for (const p of t.group_parents) {
        const g = groups.get(p['group_id']);
        if (g) g.parent_group_id = p['parent_group_id'];
    }
    const populationOf = (groupId: number | undefined) =>
        groupId === undefined ? undefined : groupChain(groupId, groups).find(isPopulation);
    // The nearest population above each entity, by the register: what an animal's note names.
    const registerPopulation = new Map<string, number>();
    for (const p of t.populationOf) if (!registerPopulation.has(p.entity_id)) registerPopulation.set(p.entity_id, p.group_id);
    const innermost = new Map<number, number>();
    for (const m of t.matriline_members) if (m['innermost_group_id'] !== null) innermost.set(m['individual_id'], m['innermost_group_id']);
    const registerNames = new Map<string, string[]>();
    for (const n of t.names) registerNames.set(n.entity_id, [...(registerNames.get(n.entity_id) ?? []), n.name]);
    const nicknames = (column: string, id: number) => t.nicknames
        .filter(n => n[column] === id && n['status'] !== 'deprecated')
        .sort(byId);
    const latest = new Map(t.latest.map(l => [`${l.kind}:${l.id}`, l]));
    const sighting = (kind: string, id: number) => {
        const l = latest.get(`${kind}:${id}`);
        return l ? {date: observedDate(l.observed_at).toString(), href: mapUrl(l)} : undefined;
    };
    const withLatest = (entry: SearchEntry, found: SearchEntry['latest']): SearchEntry => (found ? {...entry, latest: found} : entry);

    const individuals = [...t.individuals].filter(i => i['entity_id']).sort(byId).map(i => {
        const own = nicknames('individual_id', i['id']);
        const population = populationOf(innermost.get(i['id'])) ?? populationOf(registerPopulation.get(i['entity_id']));
        return withLatest({
            kind: 'individual',
            label: i['primary_designation'],
            note: [population ? populationNoun(population) : 'Killer whale', ...own.slice(0, 2).map(n => n['name'])].join(' · '),
            keys: keysOf(i['primary_designation'], ...t.designations.filter(d => d['individual_id'] === i['id']).map(d => d['code']),
                ...own.map(n => n['name']), ...(registerNames.get(i['entity_id']) ?? [])),
            href: individualPath({entity_id: i['entity_id'], primary_designation: i['primary_designation']}),
        }, sighting('individual', i['id']));
    });
    const matrilines = [...t.social_groups].filter(g => g['kind'] === 'matriline' && g['entity_id']).sort(byId).map(g => {
        const own = nicknames('social_group_id', g['id']);
        const population = populationOf(g['id']);
        return withLatest({
            kind: 'matriline',
            label: `${g['designation']}s`,
            note: ['Matriline', population ? populationLabel(population) : null, ...own.slice(0, 1).map(n => n['name'])]
                .filter(Boolean).join(' · '),
            keys: keysOf(`${g['designation']}s`, ...own.map(n => n['name']), ...(registerNames.get(g['entity_id']) ?? [])),
            href: matrilinePath({entity_id: g['entity_id'], designation: g['designation']}),
        }, sighting('group', g['id']));
    });
    const populations = [...t.social_groups].filter(g => isPopulation({kind: g['kind']}) && g['entity_id']).sort(byId).map(g => {
        const label = populationLabel({designation: g['designation']});
        return withLatest({
            kind: 'population',
            label,
            note: 'Population',
            keys: keysOf(label, label.replace(/ \([^)]*\)/, ''), g['designation'], ...(registerNames.get(g['entity_id']) ?? [])),
            href: populationPath({entity_id: g['entity_id'], designation: g['designation']}),
        }, sighting('population', g['id']));
    });
    // A pod's sightings are pooled as a population's are, in the same table (derive/profile-links.sql).
    const pods = [...t.social_groups].filter(g => g['kind'] === 'pod' && g['entity_id']).sort(byId).map(g => {
        const label = podLabel({designation: g['designation']});
        const population = populationOf(g['id']);
        return withLatest({
            kind: 'pod',
            label,
            note: ['Pod', population ? populationLabel(population) : null].filter(Boolean).join(' · '),
            keys: keysOf(label, `${g['designation']}pod`, ...(registerNames.get(g['entity_id']) ?? [])),
            href: podPath({entity_id: g['entity_id'], designation: g['designation']}),
        }, sighting('population', g['id']));
    });
    // The atlas maps some sites at several points a few hundred metres apart under one name
    // (decision 058); a list can't tell them apart, so the first by id speaks for them all.
    const seenSites = new Set<string>();
    const haulouts: SearchEntry[] = [...t.haulouts].sort(byId).flatMap(h => {
        const note = ['Haul-out site', h['region']].filter(Boolean).join(' · ');
        if (seenSites.has(`${h['name']}\n${note}`)) return [];
        seenSites.add(`${h['name']}\n${note}`);
        return [{kind: 'haulout' as const, label: h['name'], note, keys: keysOf(h['name']), href: hauloutPath({id: h['id'], name: h['name']})}];
    });
    // The map's regions are the site's, not the catalogue's; a region is a view, so it opens the map filtered to it.
    const regions: SearchEntry[] = REGIONS.filter(r => r.extent !== null).map(r => ({
        kind: 'region',
        label: r.label,
        note: 'Map region',
        keys: keysOf(r.label),
        href: `/?r=${r.slug}`,
    }));
    return {entries: [...individuals, ...matrilines, ...pods, ...populations, ...haulouts, ...regions]};
}

export async function writeSearchIndex(snapshot: string, exportDir: string): Promise<SearchIndex> {
    const index = buildSearchIndex(await readInputs(snapshot));
    // Replaced with a rename, so a reader never sees half of one.
    const file = path.join(exportDir, 'search-index.json');
    await writeFile(`${file}.partial`, JSON.stringify(index));
    await rename(`${file}.partial`, file);
    return index;
}

async function main(): Promise<void> {
    const [snapshot] = process.argv.slice(2);
    const exportDir = process.env['EXPORT_DIR'];
    if (!snapshot || !exportDir) {
        console.error('usage: EXPORT_DIR=… search-index.ts <snapshot.duckdb>');
        process.exit(2);
    }
    const {entries} = await writeSearchIndex(snapshot, exportDir);
    const count = (kind: string) => entries.filter(e => e.kind === kind).length;
    console.log(`search-index.json: ${count('individual')} individuals, ${count('matriline')} matrilines, ${count('pod')} pods, `
        + `${count('population')} populations, ${count('haulout')} haul-out sites, ${count('region')} regions; `
        + `${entries.filter(e => e.latest).length} with a latest sighting`);
}

// Only when run as a script, so the test can import the rest.
if (import.meta.main) {
    await main();
}
