/**
 * The whales page (salish-nkbq), prerendered from the read-path store.
 *
 *   EXPORT_DIR=… node scripts/read-path/whales.ts <snapshot.duckdb> <dist>
 *
 * Writes $EXPORT_DIR/whales.html: every cetacean species the register knows that has a
 * report, most-reported first, with its small map (decision 067). A cetacean is a register
 * taxon whose lineage (register.taxon_ancestor) reaches Cetacea; a report counts toward
 * its species when it names the species or something beneath it, such as an ecotype
 * (register.ancestor). The page is src/whales.ts's template inside dist/whales.html, the
 * shell Vite built, as a profile page is inside its kind's.
 */

import { readFile, rename, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import { DuckDBInstance } from '@duckdb/node-api';

import { POPULATION_KINDS, populationLabel, populationPath } from '../../src/catalog.ts';
import type { MapDot } from '../../src/individual-map.ts';
import { profileStyles, renderProfileFrame } from '../../src/profile-shared.ts';
import { renderWhales, whalesPreview, whalesStyles, type WhaleSpecies, type WhalesData } from '../../src/whales.ts';
import { budget } from './duckdb-budget.ts';
import { renderDocument } from './profile-document.ts';

/** Cetacea, as the register identifies it. */
export const CETACEA = 'SSA:0000934';

/** What the query reads, row for row. */
export type Inputs = {
    /** The register's cetacean taxa of species rank. */
    species: {entity_id: string, scientific_name: string, common_name: string | null}[],
    /** Every report of a cetacean: the taxon it reaches, and whether that taxon is a species. */
    reports: {taxon_entity_id: string, species: boolean, occurrence_id: string, observed_at: string,
        lon: number | null, lat: number | null}[],
    /** The populations with pages, an ecotype or a community (decision 070), and the taxon each belongs to. */
    populations: {taxon_entity_id: string, entity_id: string, designation: string}[],
};

/**
 * An entity's taxon: itself, if it is one, or the nearest taxon above it, which for an
 * ecotype or a population is its species.
 */
const ENTITY_TAXON = `
    SELECT e.entity_id,
           CASE WHEN e.kind = 'taxon' THEN e.entity_id
                ELSE (SELECT arg_min(a.ancestor_id, a.depth) FROM store.register.ancestor a
                      WHERE a.entity_id = e.entity_id AND a.ancestor_kind = 'taxon') END AS taxon_entity_id
    FROM store.register.entities e`;

/** The register's taxa under Cetacea, Cetacea included, with their rank. */
const CETACEAN_TAXA = `
    SELECT c.entity_id, c.scientific_name, c.taxon_rank
    FROM store.register.classification c
    JOIN store.register.entities e ON e.entity_id = c.entity_id AND e.kind = 'taxon'
    WHERE c.taxon_id IN (
        SELECT a.taxon_id FROM store.register.taxon_ancestor a
        WHERE a.ancestor_id = (SELECT taxon_id FROM store.register.classification WHERE entity_id = '${CETACEA}'))`;

export async function readInputs(snapshot: string): Promise<Inputs> {
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        // Measured on 64,000 occurrences with documents of 1.3 KB on average (production's
        // are 1.1): runs out at 64 and 96 MB, completes at 128, peaking at 370 MB resident
        // with the page's rendering. The first production build ran out at 64.
        await budget(conn, snapshot, '128MB');
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        await conn.run(`CREATE TEMP TABLE entity_taxon AS ${ENTITY_TAXON}`);
        await conn.run(`CREATE TEMP TABLE cetacean_taxa AS ${CETACEAN_TAXA}`);
        const rows = async <T>(sql: string) => (await conn.runAndReadAll(sql)).getRowObjectsJS() as unknown as T[];
        const species = await rows<Inputs['species'][number]>(`
            SELECT t.entity_id, t.scientific_name, json_extract_string(n.doc, '$.common_name') AS common_name
            FROM cetacean_taxa t
            LEFT JOIN store.snapshot.animal_names n ON json_extract_string(n.doc, '$.entity_id') = t.entity_id
            WHERE t.taxon_rank = 'species'
            ORDER BY t.entity_id`);
        // Sorted below rather than here, newest first and a tie by id, so the same store
        // renders the same page without DuckDB holding the extracted rows for a sort.
        const reports = (await rows<Inputs['reports'][number] & {at: number}>(`
            SELECT t.entity_id AS taxon_entity_id, t.taxon_rank = 'species' AS species,
                   o.id AS occurrence_id, json_extract_string(o.doc, '$.observed_at') AS observed_at,
                   json_extract(o.doc, '$.location.lon')::DOUBLE AS lon,
                   json_extract(o.doc, '$.location.lat')::DOUBLE AS lat,
                   epoch(o.observed_at) AS at
            FROM store.build.occurrences o
            JOIN entity_taxon et ON et.entity_id = json_extract_string(o.doc, '$.taxon.entity_id')
            JOIN cetacean_taxa t ON t.entity_id = et.taxon_entity_id`))
            .sort((a, b) => b.at - a.at || (a.occurrence_id < b.occurrence_id ? -1 : a.occurrence_id > b.occurrence_id ? 1 : 0))
            .map(({at: _, ...r}) => r);
        const populations = await rows<Inputs['populations'][number]>(`
            SELECT et.taxon_entity_id, json_extract_string(g.doc, '$.entity_id') AS entity_id,
                   json_extract_string(g.doc, '$.designation') AS designation
            FROM store.snapshot.social_groups g
            JOIN entity_taxon et ON et.entity_id = json_extract_string(g.doc, '$.entity_id')
            WHERE json_extract_string(g.doc, '$.kind') IN (${POPULATION_KINDS.map(k => `'${k}'`).join(', ')})
            ORDER BY designation`);
        return {species, reports, populations};
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}

/** The page's data: the species with reports, most-reported first, a tie by name. */
export function assembleWhales({species, reports, populations}: Inputs): WhalesData {
    const bySpecies = new Map<string, MapDot[]>();
    let unidentified = 0;
    for (const r of reports) {
        if (!r.species) { unidentified++; continue; }
        let dots = bySpecies.get(r.taxon_entity_id);
        if (!dots) bySpecies.set(r.taxon_entity_id, dots = []);
        dots.push({occurrence_id: r.occurrence_id, observed_at: r.observed_at,
            location: r.lon === null || r.lat === null ? null : {lon: r.lon, lat: r.lat}});
    }
    const list: WhaleSpecies[] = species
        .filter(s => bySpecies.has(s.entity_id))
        .map(s => ({
            entity_id: s.entity_id,
            common_name: s.common_name ?? s.scientific_name,
            scientific_name: s.scientific_name,
            reports: bySpecies.get(s.entity_id)!,
            populations: populations.filter(p => p.taxon_entity_id === s.entity_id).map(p => ({
                href: populationPath(p),
                label: populationLabel(p).replace(/ killer whales$/, ''),
            })),
        }))
        .sort((a, b) => b.reports.length - a.reports.length || a.common_name.localeCompare(b.common_name));
    return {species: list, unidentified};
}

export function renderWhalesPage(shell: string, data: WhalesData): string {
    return renderDocument(shell, 'whales-page', [profileStyles, ...whalesStyles], whalesPreview(),
        renderProfileFrame(renderWhales(data), 'whales'));
}

export async function writeWhales(snapshot: string, exportDir: string, dist: string): Promise<WhalesData> {
    const shell = await readFile(path.join(dist, 'whales.html'), 'utf8');
    const data = assembleWhales(await readInputs(snapshot));
    // Replaced with a rename, so a reader never sees half of one.
    const file = path.join(exportDir, 'whales.html');
    await writeFile(`${file}.partial`, renderWhalesPage(shell, data));
    await rename(`${file}.partial`, file);
    return data;
}

async function main(): Promise<void> {
    const [snapshot, dist] = process.argv.slice(2);
    const exportDir = process.env['EXPORT_DIR'];
    if (!snapshot || !dist || !exportDir) {
        console.error('usage: EXPORT_DIR=… whales.ts <snapshot.duckdb> <dist>');
        process.exit(2);
    }
    const {species, unidentified} = await writeWhales(snapshot, exportDir, dist);
    console.log(`whales.html: ${species.length} species, ${species.reduce((n, s) => n + s.reports.length, 0)} reports, ${unidentified} named only above species`);
}

// Only when run as a script, so the test can import the rest.
if (import.meta.main) {
    await main();
}
