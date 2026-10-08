/**
 * The profile pages, prerendered from the read-path snapshot (decision 057).
 *
 *   EXPORT_DIR=… node scripts/read-path/profiles.ts <kind> <snapshot.duckdb> <dist>
 *
 * <kind> is individuals, matrilines, populations, pods or haulouts. Writes $EXPORT_DIR/profiles/<kind>/<id>.html
 * for every subject of that kind (<id> is its register identifier's seven digits, or a
 * haul-out site's id: the register holds animals, not places),
 * and beside it <id>.links.json, the sighting links its map loads. The page itself is
 * the kind's templates (src/individual-profile.ts and its siblings) — the same ones the
 * client-rendered page uses — given the data the client would fetch, assembled here
 * from the snapshot's documents instead. Each kind reads only its own tables, which is
 * what the Stelis task running it declares as its inputs.
 *
 * Assembly mirrors src/catalog.ts's fetchers one for one, and where PostgREST leaves an
 * order unspecified (embedded nicknames and designations, a matriline's members), this
 * fixes one, so the same snapshot always renders the same bytes. The presence table's
 * newest year is the snapshot's, not the clock's.
 *
 * <dist> is the site Vite built: the page's shell (individual.html), and the manifest
 * naming the map island's files, which a page with a map loads and nothing else.
 */

import { readFile } from 'node:fs/promises';
import * as path from 'node:path';

import {
    dedupeOccurrenceLinks, descendantMatrilines, displayName, groupChain, hauloutReport, hauloutSite, isPopulation,
    HAULOUT_SITES_FILE, type CatalogGroup, type Haulout, type HauloutOccurrence, type HauloutSite, type OccurrenceLink,
} from '../../src/catalog.ts';
import type { MapDot } from '../../src/individual-map.ts';
import { profileStyles, renderProfileFrame } from '../../src/profile-shared.ts';
import {
    individualPreview, individualStyles, renderIndividualProfile, renderIndividualSightings,
    type IndividualProfileData,
} from '../../src/individual-profile.ts';
import {
    matrilinePreview, renderMatrilineProfile, renderMatrilineSightings, type MatrilineProfileData,
} from '../../src/matriline-profile.ts';
import {
    ecotypePreview, ecotypeStyles, renderEcotypeProfile, renderEcotypeSightings, type EcotypeProfileData,
} from '../../src/ecotype-profile.ts';
import {
    hauloutPreview, hauloutProfile, hauloutStyles, renderHauloutProfile, renderHauloutReports, renderHauloutVitals,
    type HauloutProfileData,
} from '../../src/haulout-profile.ts';
import { islandFromManifest, renderDocument, SEARCH_ISLAND, type Island } from './profile-document.ts';
import { recoverDir, replaceDir } from './replace-dir.ts';
import { readSnapshot, type Doc, type Table, type Tables } from './snapshot-tables.ts';

export type { Tables } from './snapshot-tables.ts';

const byId = (a: Doc, b: Doc) => a['id'] - b['id'];

/** The seven digits of a register identifier: a page's file name and URL segment. */
const localPart = (entityId: string) => entityId.replace(/^SSA:/, '');

/** Documents grouped by a key column, each group in the order `sort` gives. */
function groupBy(docs: Doc[], key: string, sort: (a: Doc, b: Doc) => number): Map<unknown, Doc[]> {
    const out = new Map<unknown, Doc[]>();
    for (const d of [...docs].sort(sort)) {
        if (d[key] === null) continue;
        let list = out.get(d[key]);
        if (!list) out.set(d[key], list = []);
        list.push(d);
    }
    return out;
}

// --- Assembly shared between kinds, mirroring src/catalog.ts's fetchers ---------------

/** An embedded party (authority, namer), as PostgREST embeds it. */
function partyResolver(t: Pick<Tables, 'parties'>) {
    const parties = new Map(t.parties.map(p => [p['id'], p]));
    return (id: number | null) => {
        const p = id === null ? undefined : parties.get(id);
        return p ? {name: p['name'], url: p['url']} : null;
    };
}

/**
 * fetchAllGroups' shape: every group, its parent, and — given the individuals — its
 * anchor's address. The ecotype page reads no anchor, so it needn't read individuals.
 */
function catalogGroups(t: Pick<Tables, 'social_groups' | 'group_parents'>, individuals?: Map<number, Doc>): Map<number, CatalogGroup> {
    const parentOf = new Map(t.group_parents.map(p => [p['group_id'], p['parent_group_id']]));
    return new Map<number, CatalogGroup>(t.social_groups.map(g => {
        const anchor = g['anchor_individual_id'] === null ? undefined : individuals?.get(g['anchor_individual_id']);
        return [g['id'], {
            ...g,
            anchor: anchor ? {entity_id: anchor['entity_id'], primary_designation: anchor['primary_designation']} : null,
            parent_group_id: parentOf.get(g['id']) ?? null,
        } as CatalogGroup];
    }));
}

/** Sighting links by subject, in occurrence order, as the fetchers ask PostgREST for them. */
function linksBy(docs: Doc[], key: string): (id: number) => OccurrenceLink[] {
    const bySubject = groupBy(docs, key, (a, b) => a['occurrence_id'].localeCompare(b['occurrence_id']));
    return id => dedupeOccurrenceLinks((bySubject.get(id) ?? []) as never);
}

/** The individual-level pieces the individual and matriline pages both show. */
function individualCatalogue(t: Pick<Tables, 'individuals' | 'nicknames' | 'matriline_members'>) {
    const individuals = new Map(t.individuals.map(i => [i['id'], i]));
    const nicknamesOf = groupBy(t.nicknames, 'individual_id', byId);
    const briefNicknames = (id: number) => (nicknamesOf.get(id) ?? []).map(n => ({name: n['name'], status: n['status']}));
    const membersOf = groupBy(t.matriline_members, 'group_id', (a, b) => a['individual_id'] - b['individual_id']);
    // fetchGroupMembers' shape.
    const members = (groupId: number) => (membersOf.get(groupId) ?? []).flatMap(m => {
        const member = individuals.get(m['individual_id']);
        return member ? [{innermost_group_id: m['innermost_group_id'], individual: {
            id: member['id'], entity_id: member['entity_id'], primary_designation: member['primary_designation'],
            sex: member['sex'], born_earliest: member['born_earliest'], life_status: member['life_status'],
            nicknames: briefNicknames(member['id']),
        }}] : [];
    });
    return {individuals, nicknamesOf, briefNicknames, members};
}

// --- Individuals ----------------------------------------------------------------------

export type ProfilePage<D> = {
    /** The page's file name and URL segment: a register identifier's seven digits, or a site's id. */
    id: string,
    data: D,
    /** What the page's map draws, and the file its map loads them from. */
    links: MapDot[],
};

export type IndividualPage = ProfilePage<IndividualProfileData> & {links: OccurrenceLink[]};

const INDIVIDUAL_TABLES = [
    'individuals', 'designations', 'nicknames', 'parties', 'social_groups', 'group_parents',
    'matriline_members', 'animal_names', 'individual_occurrences',
] as const;

/** Every individual with a register identifier, as its page's data. */
export function assembleIndividuals(t: Pick<Tables, (typeof INDIVIDUAL_TABLES)[number]>): IndividualPage[] {
    const party = partyResolver(t);
    const {individuals, nicknamesOf, briefNicknames, members: membersOf} = individualCatalogue(t);
    const designationsOf = groupBy(t.designations, 'individual_id', byId);

    // fetchParents / fetchOffspring's shapes.
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

    const groups = catalogGroups(t, individuals);
    const innermostOf = new Map<number, number>();
    for (const m of [...t.matriline_members].sort((a, b) => a['individual_id'] - b['individual_id']))
        if (m['innermost_group_id'] !== null) innermostOf.set(m['individual_id'], m['innermost_group_id']);
    const names = new Map(t.animal_names.map(n => [n['entity_id'], n]));
    const linksOf = linksBy(t.individual_occurrences, 'individual_id');

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
            const members = matriline ? membersOf(matriline.id) : [];
            const population = matriline ? groupChain(matriline.id, groups).find(isPopulation) ?? null : null;
            const species = (population?.entity_id ? names.get(population.entity_id)?.['common_name'] : null)
                ?? names.get(i['entity_id'])?.['taxon_common_name']
                ?? null;
            const data = {
                profile, offspring: offspringOf(i['id']), groups, matriline, members,
                mother: parent(i['mother_id']), father: parent(i['father_id']),
                name: displayName(profile.nicknames), species,
            } satisfies IndividualProfileData;
            return {id: localPart(i['entity_id']), data, links: linksOf(i['id'])};
        });
}

/** Where a page's map loads its points: served from the export by the read path. */
export const linksUrl = (kind: Kind, id: string) => `/read-path/profiles/${kind}/${id}.links.json`;

export function renderIndividualPage(shell: string, page: IndividualPage, currentYear: number, islands: Island[] = []): string {
    const {data, links} = page;
    const sightings = renderIndividualSightings(data.profile.primary_designation, links,
        {mapSrc: linksUrl('individuals', page.id), currentYear});
    return renderDocument(shell, 'individual-page', [profileStyles, individualStyles],
        individualPreview(data), renderProfileFrame(renderIndividualProfile(data, sightings)), islands);
}

// --- Matrilines -----------------------------------------------------------------------

export type MatrilinePage = ProfilePage<MatrilineProfileData> & {links: OccurrenceLink[]};

const MATRILINE_TABLES = [
    'social_groups', 'group_parents', 'nicknames', 'parties', 'individuals', 'matriline_members', 'group_occurrences',
] as const;

/** Every matriline with a register identifier, as its page's data. */
export function assembleMatrilines(t: Pick<Tables, (typeof MATRILINE_TABLES)[number]>): MatrilinePage[] {
    const party = partyResolver(t);
    const {individuals, briefNicknames, members} = individualCatalogue(t);
    const groups = catalogGroups(t, individuals);
    const nicknamesOf = groupBy(t.nicknames, 'social_group_id', byId);
    const linksOf = linksBy(t.group_occurrences, 'social_group_id');
    return t.social_groups
        .filter(g => g['kind'] === 'matriline' && g['entity_id'])
        .sort(byId)
        .map(g => {
            // fetchMatriline's shape: the group, its names, and its anchor.
            const anchor = g['anchor_individual_id'] === null ? undefined : individuals.get(g['anchor_individual_id']);
            const group = {
                id: g['id'], entity_id: g['entity_id'], designation: g['designation'],
                nicknames: (nicknamesOf.get(g['id']) ?? []).map(n => ({
                    name: n['name'], theme: n['theme'], status: n['status'], named_year: n['named_year'],
                    namer: party(n['namer_id']),
                })),
                anchor: anchor ? {id: anchor['id'], entity_id: anchor['entity_id'],
                    primary_designation: anchor['primary_designation'], life_status: anchor['life_status'],
                    nicknames: briefNicknames(anchor['id'])} : null,
            };
            const data = {
                group, groups, members: members(g['id']), name: displayName(group.nicknames),
            } satisfies MatrilineProfileData;
            return {id: localPart(g['entity_id']), data, links: linksOf(g['id'])};
        });
}

export function renderMatrilinePage(shell: string, page: MatrilinePage, currentYear: number, islands: Island[] = []): string {
    const {data, links} = page;
    const sightings = renderMatrilineSightings(data.group.designation, links,
        {mapSrc: linksUrl('matrilines', page.id), currentYear});
    return renderDocument(shell, 'matriline-page', [profileStyles],
        matrilinePreview(data), renderProfileFrame(renderMatrilineProfile(data, sightings)), islands);
}

// --- Ecotypes -------------------------------------------------------------------------

export type EcotypePage = ProfilePage<EcotypeProfileData> & {links: OccurrenceLink[]};

// group_occurrences: each matriline's reports, for its small map (decision 067).
const ECOTYPE_TABLES = ['social_groups', 'group_parents', 'ecotype_occurrences', 'group_occurrences'] as const;

/**
 * The pages of the groups `isSubject` picks, each a population's page or a pod's, as their
 * data: the group, the matrilines under it with each one's reports, and the sightings of
 * everything under it, pooled. ecotype_occurrences has a pod's too (derive/profile-links.sql).
 */
function assembleGroupPages(t: Pick<Tables, (typeof ECOTYPE_TABLES)[number]>, isSubject: (g: Doc) => boolean): EcotypePage[] {
    const groups = catalogGroups(t);
    const linksOf = linksBy(t.ecotype_occurrences, 'ecotype_id');
    const matrilineLinksOf = linksBy(t.group_occurrences, 'social_group_id');
    // A small map draws where, and links to the matriline's page rather than to a report.
    const dots = (id: number) => matrilineLinksOf(id).map(({occurrence_id, observed_at, location}) =>
        ({occurrence_id, observed_at, location}));
    const link = (g: CatalogGroup) => ({id: g.id, entity_id: g.entity_id, designation: g.designation});
    const pods = [...groups.values()].filter(g => g.kind === 'pod' && g.entity_id).sort((a, b) => a.id - b.id);
    return t.social_groups
        .filter(g => isSubject(g) && g['entity_id'])
        .sort(byId)
        .map(g => {
            const matrilines = descendantMatrilines(g['id'], groups);
            const population = g['kind'] === 'pod' ? groupChain(g['id'], groups).find(isPopulation) : undefined;
            const data = {
                group: {id: g['id'], entity_id: g['entity_id'], designation: g['designation'], kind: g['kind']},
                matrilines,
                matrilineReports: new Map(matrilines.map(m => [m.id, dots(m.id)])),
                ...(population ? {population: link(population)} : {}),
                ...(isPopulation({kind: g['kind']})
                    ? {pods: pods.filter(p => groupChain(p.id, groups).some(a => a.id === g['id'])).map(link)}
                    : {}),
            } satisfies EcotypeProfileData;
            return {id: localPart(g['entity_id']), data, links: linksOf(g['id'])};
        });
}

/** Every population with a register identifier, an ecotype or a community (decision 070), as its page's data. */
export const assembleEcotypes = (t: Pick<Tables, (typeof ECOTYPE_TABLES)[number]>): EcotypePage[] =>
    assembleGroupPages(t, g => isPopulation({kind: g['kind']}));

/** Every Southern Resident pod, the level between the community and its matrilines (070), as its page's data. */
export const assemblePods = (t: Pick<Tables, (typeof ECOTYPE_TABLES)[number]>): EcotypePage[] =>
    assembleGroupPages(t, g => g['kind'] === 'pod');

const renderGroupPage = (kind: 'populations' | 'pods') =>
    (shell: string, page: EcotypePage, currentYear: number, islands: Island[] = []): string => {
        const {data, links} = page;
        const sightings = renderEcotypeSightings(links, {mapSrc: linksUrl(kind, page.id), currentYear},
            kind === 'pods' ? 'pod' : 'population');
        return renderDocument(shell, 'ecotype-page', [profileStyles, ...ecotypeStyles],
            ecotypePreview(data), renderProfileFrame(renderEcotypeProfile(data, sightings)), islands);
    };

export const renderEcotypePage = renderGroupPage('populations');
export const renderPodPage = renderGroupPage('pods');

// --- Haul-out sites --------------------------------------------------------------------

export type HauloutPage = ProfilePage<HauloutProfileData & {reports: ReturnType<typeof hauloutReport>}>;

const HAULOUT_TABLES = ['haulouts', 'haulout_occurrences'] as const;

/** Every haul-out site, as its page's data: fetchHaulout, fetchAllHaulouts and fetchHauloutReports' shapes. */
export function assembleHaulouts(t: Pick<Tables, (typeof HAULOUT_TABLES)[number]>): HauloutPage[] {
    const all = [...t.haulouts].sort(byId) as Haulout[];
    // observed_at newest first, then occurrence_id, as fetchHauloutReports orders.
    const reportsOf = groupBy(t.haulout_occurrences, 'haulout_id', (a, b) =>
        b['observed_at'].localeCompare(a['observed_at']) || a['occurrence_id'].localeCompare(b['occurrence_id']));
    return all.map(site => {
        const reports = (reportsOf.get(site.id) ?? []).flatMap(r => hauloutReport(r as HauloutOccurrence));
        return {
            id: String(site.id),
            data: {...hauloutProfile(site, all), reports},
            // The map's dots: only what it reads of each report.
            links: reports.filter(r => r.location).map(({occurrence_id, observed_at, location}) => ({occurrence_id, observed_at, location})),
        };
    });
}

/** Every site, as the main map's haul-out layer draws them (GH #453): what fetchHauloutSites gets. */
export function assembleHauloutSites(t: Pick<Tables, 'haulouts'>): HauloutSite[] {
    return ([...t.haulouts].sort(byId) as Haulout[]).map(hauloutSite);
}

export function renderHauloutPage(shell: string, page: HauloutPage, currentYear: number, islands: Island[] = []): string {
    const {site, reports} = page.data;
    const body = renderHauloutProfile(page.data, {
        vitals: renderHauloutVitals(site, reports),
        dots: reports.filter(r => r.location),
        reports: renderHauloutReports(site, reports, currentYear),
        mapSrc: linksUrl('haulouts', page.id),
    });
    return renderDocument(shell, 'haulout-page', [profileStyles, hauloutStyles],
        hauloutPreview(page.data), renderProfileFrame(body), islands);
}

// --- Writing a kind's pages -----------------------------------------------------------

/** The map island's entry, as vite.config.js names it. */
export const MAP_ISLAND = 'src/map-island.ts';

type File = [name: string, content: string];

/**
 * A kind's pages as files: each page, and beside it the links its map loads. A
 * kind may also write files about all its subjects at once, beside the pages.
 */
const pagesOf = <T extends Table, P extends ProfilePage<unknown>>(
    names: readonly T[],
    assemble: (t: Pick<Tables, T>) => P[],
    render: (shell: string, page: P, currentYear: number, islands: Island[]) => string,
    index: (t: Pick<Tables, T>) => File[] = () => [],
) => async (snapshot: string, shell: string, islands: Island[]): Promise<{pages: File[][], index: File[]}> => {
    const {tables, currentYear} = await readSnapshot(snapshot, async s => ({tables: await s.tables(names), currentYear: await s.year()}));
    const pages = assemble(tables).map((page): File[] => [
        [`${page.id}.html`, render(shell, page, currentYear, islands)],
        [`${page.id}.links.json`, JSON.stringify(page.links)],
    ]);
    return {pages, index: index(tables)};
};

const KINDS = {
    individuals: {shell: 'individual.html', pages: pagesOf(INDIVIDUAL_TABLES, assembleIndividuals, renderIndividualPage)},
    matrilines: {shell: 'matriline.html', pages: pagesOf(MATRILINE_TABLES, assembleMatrilines, renderMatrilinePage)},
    populations: {shell: 'ecotype.html', pages: pagesOf(ECOTYPE_TABLES, assembleEcotypes, renderEcotypePage)},
    // A pod's page is a population's a level down, in the same shell: no client-rendered
    // page reads it, since its rows exist only in the build (decision 070).
    pods: {shell: 'ecotype.html', pages: pagesOf(ECOTYPE_TABLES, assemblePods, renderPodPage)},
    // The sites' own list, for the main map's layer: a page's id is a number, so
    // it cannot collide with one.
    haulouts: {shell: 'haulout.html', pages: pagesOf(HAULOUT_TABLES, assembleHaulouts, renderHauloutPage,
        t => [[HAULOUT_SITES_FILE, JSON.stringify(assembleHauloutSites(t))]])},
};
export type Kind = keyof typeof KINDS;

const isKind = (s: string | undefined): s is Kind => s !== undefined && Object.hasOwn(KINDS, s);

export async function writeProfiles(kind: Kind, snapshot: string, exportDir: string, dist: string): Promise<{pages: number}> {
    const outDir = path.join(exportDir, 'profiles', kind);
    await recoverDir(outDir);
    const shell = await readFile(path.join(dist, KINDS[kind].shell), 'utf8');
    const manifest = JSON.parse(await readFile(path.join(dist, '.vite', 'manifest.json'), 'utf8'));
    const islands = [islandFromManifest(manifest, MAP_ISLAND, 'individual-map'),
        islandFromManifest(manifest, SEARCH_ISLAND, 'site-search')];
    const {pages, index} = await KINDS[kind].pages(snapshot, shell, islands);
    await replaceDir(outDir, [...pages.flat(), ...index]);
    return {pages: pages.length};
}

export async function main(): Promise<void> {
    const [kind, snapshot, dist] = process.argv.slice(2);
    const exportDir = process.env['EXPORT_DIR'];
    if (!isKind(kind) || !snapshot || !dist || !exportDir) {
        console.error(`usage: EXPORT_DIR=… profiles.ts <${Object.keys(KINDS).join('|')}> <snapshot.duckdb> <dist>`);
        process.exit(2);
    }
    const {pages} = await writeProfiles(kind, snapshot, exportDir, dist);
    console.log(`profiles/${kind}/: ${pages} page${pages === 1 ? '' : 's'}`);
}

if (import.meta.main) {
    await main();
}
