/**
 * The individual profile pages, prerendered from the read-path snapshot (decision 057).
 *
 *   EXPORT_DIR=… tsx scripts/read-path/profiles.ts <snapshot.duckdb> <dist>
 *
 * Writes $EXPORT_DIR/profiles/individuals/<id>.html for every individual with a register
 * identifier (<id> is its seven digits), and beside it <id>.links.json, the sighting
 * links its map loads. The page itself is src/individual-profile.ts's templates — the
 * same ones the client-rendered page uses — given the data the client would fetch,
 * assembled here from the snapshot's documents instead.
 *
 * Assembly mirrors src/catalog.ts's fetchers one for one, and where PostgREST leaves an
 * order unspecified (embedded nicknames and designations, a matriline's members), this
 * fixes one, so the same snapshot always renders the same bytes. The presence table's
 * newest year is the snapshot's, not the clock's.
 *
 * <dist> is the site Vite built: the page's shell (individual.html), and the manifest
 * naming the map island's files, which a page with a map loads and nothing else.
 */

import { DuckDBInstance } from '@duckdb/node-api';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

import { dedupeOccurrenceLinks, displayName, groupChain, type CatalogGroup, type OccurrenceLink } from '../../src/catalog.ts';
import { profileStyles } from '../../src/profile-shared.ts';
import {
    individualPreview, individualStyles, renderIndividualFrame, renderIndividualProfile, renderIndividualSightings,
    type IndividualProfileData,
} from '../../src/individual-profile.ts';
import { islandFromManifest, renderDocument, type Island } from './profile-document.ts';
import { recoverDir, replaceDir } from './replace-dir.ts';

/** The frontend's day and year, as in occurrence-days.ts. */
const DAY_ZONE = 'PST8PDT';

// Snapshot documents, as Postgres serialized them. Loosely typed here and narrowed by
// what assembly builds from them, which the page's types check.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = Record<string, any>;

const TABLES = [
    'individuals', 'designations', 'nicknames', 'parties', 'social_groups', 'group_parents',
    'matriline_members', 'animal_names', 'individual_occurrences',
] as const;
export type Tables = Record<(typeof TABLES)[number], Doc[]>;

export async function loadTables(snapshot: string): Promise<{tables: Tables, currentYear: number}> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        const tables = {} as Tables;
        for (const name of TABLES) {
            const reader = await conn.runAndReadAll(`SELECT doc FROM store.snapshot.${name}`);
            tables[name] = (reader.getRows() as [string][]).map(([doc]) => JSON.parse(doc));
        }
        const year = await conn.runAndReadAll(
            `SELECT year(timezone('${DAY_ZONE}', taken_at))::INTEGER FROM store.snapshot.meta`);
        return {tables, currentYear: (year.getRows() as [number][])[0]![0]};
    } finally {
        conn.closeSync();
    }
}

const byId = (a: Doc, b: Doc) => a['id'] - b['id'];

export type IndividualPage = {
    /** The register identifier's seven digits: the page's file name and URL segment. */
    id: string,
    data: IndividualProfileData,
    links: OccurrenceLink[],
};

/** Every individual with a register identifier, as its page's data. */
export function assembleIndividuals(t: Tables): IndividualPage[] {
    const parties = new Map(t.parties.map(p => [p['id'], p]));
    const party = (id: number | null) => {
        const p = id === null ? undefined : parties.get(id);
        return p ? {name: p['name'], url: p['url']} : null;
    };
    const nicknamesOf = new Map<number, Doc[]>();
    for (const n of [...t.nicknames].sort(byId)) {
        if (n['individual_id'] === null) continue;
        let list = nicknamesOf.get(n['individual_id']);
        if (!list) nicknamesOf.set(n['individual_id'], list = []);
        list.push(n);
    }
    const designationsOf = new Map<number, Doc[]>();
    for (const d of [...t.designations].sort(byId)) {
        let list = designationsOf.get(d['individual_id']);
        if (!list) designationsOf.set(d['individual_id'], list = []);
        list.push(d);
    }
    const individuals = new Map(t.individuals.map(i => [i['id'], i]));
    const briefNicknames = (id: number) => (nicknamesOf.get(id) ?? []).map(n => ({name: n['name'], status: n['status']}));

    // fetchParents / fetchOffspring / fetchGroupMembers' shapes.
    const parent = (id: number | null) => {
        const i = id === null ? undefined : individuals.get(id);
        return i ? {id: i['id'], entity_id: i['entity_id'], primary_designation: i['primary_designation'],
            life_status: i['life_status'], nicknames: briefNicknames(i['id'])} : null;
    };
    const offspringOf = (id: number) => t.individuals
        .filter(i => i['mother_id'] === id || i['father_id'] === id)
        // born_earliest ascending, nulls first, as fetchOffspring orders; then id, so ties hold still.
        .sort((a, b) => (a['born_earliest'] ?? -Infinity) - (b['born_earliest'] ?? -Infinity) || a['id'] - b['id'])
        .map(i => ({id: i['id'], entity_id: i['entity_id'], primary_designation: i['primary_designation'],
            sex: i['sex'], born_earliest: i['born_earliest'], born_latest: i['born_latest'],
            life_status: i['life_status'], nicknames: briefNicknames(i['id'])}));

    // fetchAllGroups' shape: every group, its anchor's address, its parent.
    const parentOf = new Map(t.group_parents.map(p => [p['group_id'], p['parent_group_id']]));
    const groups = new Map<number, CatalogGroup>(t.social_groups.map(g => {
        const anchor = g['anchor_individual_id'] === null ? undefined : individuals.get(g['anchor_individual_id']);
        return [g['id'], {
            ...g,
            anchor: anchor ? {entity_id: anchor['entity_id'], primary_designation: anchor['primary_designation']} : null,
            parent_group_id: parentOf.get(g['id']) ?? null,
        } as CatalogGroup];
    }));
    const innermostOf = new Map<number, number>();
    const membersOf = new Map<number, Doc[]>();
    for (const m of [...t.matriline_members].sort((a, b) => a['individual_id'] - b['individual_id'])) {
        if (m['innermost_group_id'] !== null) innermostOf.set(m['individual_id'], m['innermost_group_id']);
        let list = membersOf.get(m['group_id']);
        if (!list) membersOf.set(m['group_id'], list = []);
        list.push(m);
    }
    const names = new Map(t.animal_names.map(n => [n['entity_id'], n]));
    const linksOf = new Map<number, Doc[]>();
    for (const l of [...t.individual_occurrences].sort((a, b) => a['occurrence_id'].localeCompare(b['occurrence_id']))) {
        let list = linksOf.get(l['individual_id']);
        if (!list) linksOf.set(l['individual_id'], list = []);
        list.push(l);
    }

    return t.individuals
        .filter(i => i['entity_id'])
        .sort(byId)
        .map(i => {
            const profile = {
                id: i['id'], entity_id: i['entity_id'], primary_designation: i['primary_designation'],
                sex: i['sex'], born_earliest: i['born_earliest'], born_latest: i['born_latest'],
                life_status: i['life_status'], maternity_certainty: i['maternity_certainty'],
                paternity_certainty: i['paternity_certainty'],
                designations: (designationsOf.get(i['id']) ?? []).map(d => ({
                    code: d['code'], scheme: d['scheme'], is_primary: d['is_primary'], status: d['status'],
                    in_catalog: d['in_catalog'], authority: party(d['authority_id']),
                })),
                nicknames: (nicknamesOf.get(i['id']) ?? []).map(n => ({
                    name: n['name'], theme: n['theme'], status: n['status'], named_year: n['named_year'],
                    namer: party(n['namer_id']),
                })),
            };
            const innermostId = innermostOf.get(i['id']);
            const matriline = innermostId !== undefined ? groups.get(innermostId) ?? null : null;
            const members = matriline ? (membersOf.get(matriline.id) ?? []).flatMap(m => {
                const member = individuals.get(m['individual_id']);
                return member ? [{innermost_group_id: m['innermost_group_id'], individual: {
                    id: member['id'], entity_id: member['entity_id'], primary_designation: member['primary_designation'],
                    sex: member['sex'], born_earliest: member['born_earliest'], life_status: member['life_status'],
                    nicknames: briefNicknames(member['id']),
                }}] : [];
            }) : [];
            const ecotype = matriline ? groupChain(matriline.id, groups).find(g => g.kind === 'ecotype') ?? null : null;
            const species = (ecotype?.entity_id ? names.get(ecotype.entity_id)?.['common_name'] : null)
                ?? names.get(i['entity_id'])?.['taxon_common_name']
                ?? null;
            const data = {
                profile, offspring: offspringOf(i['id']), groups, matriline, members,
                mother: parent(i['mother_id']), father: parent(i['father_id']),
                name: displayName(profile.nicknames), species,
            } satisfies IndividualProfileData;
            return {
                id: i['entity_id'].replace(/^SSA:/, ''),
                data,
                links: dedupeOccurrenceLinks((linksOf.get(i['id']) ?? []) as never),
            };
        });
}

/** Where a page's map loads its points: served from the export by the read path. */
export const linksUrl = (id: string) => `/read-path/profiles/individuals/${id}.links.json`;

export function renderIndividualPage(shell: string, page: IndividualPage, currentYear: number, islands: Island[] = []): string {
    const {data, links} = page;
    const sightings = renderIndividualSightings(data.profile.primary_designation, links,
        {mapSrc: linksUrl(page.id), currentYear});
    return renderDocument(shell, 'individual-page', [profileStyles, individualStyles],
        individualPreview(data), renderIndividualFrame(renderIndividualProfile(data, sightings)), islands);
}

/** The map island's entry, as vite.config.js names it. */
export const MAP_ISLAND = 'src/map-island.ts';

export async function writeProfiles(snapshot: string, exportDir: string, dist: string): Promise<{pages: number}> {
    const outDir = path.join(exportDir, 'profiles', 'individuals');
    await recoverDir(outDir);
    const shell = await readFile(path.join(dist, 'individual.html'), 'utf8');
    const manifest = JSON.parse(await readFile(path.join(dist, '.vite', 'manifest.json'), 'utf8'));
    const islands = [islandFromManifest(manifest, MAP_ISLAND, 'individual-map')];
    const {tables, currentYear} = await loadTables(snapshot);
    const pages = assembleIndividuals(tables);
    const files: [string, string][] = [];
    for (const page of pages) {
        files.push([`${page.id}.html`, renderIndividualPage(shell, page, currentYear, islands)]);
        files.push([`${page.id}.links.json`, JSON.stringify(page.links)]);
    }
    await replaceDir(outDir, files);
    return {pages: pages.length};
}

export async function main(): Promise<void> {
    const [snapshot, dist] = process.argv.slice(2);
    const exportDir = process.env['EXPORT_DIR'];
    if (!snapshot || !dist || !exportDir) {
        console.error('usage: EXPORT_DIR=… profiles.ts <snapshot.duckdb> <dist>');
        process.exit(2);
    }
    const {pages} = await writeProfiles(snapshot, exportDir, dist);
    console.log(`profiles/individuals/: ${pages} pages`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await main();
}
