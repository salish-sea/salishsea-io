/**
 * The Darwin Core archive, written by the read-path build (decision 061, salish-xv35.9).
 *
 *   EXPORT_DIR=… node scripts/read-path/dwca.ts <snapshot.duckdb> <maplify.sqlite> <inaturalist.sqlite> <orcasound.sqlite>
 *
 * Writes $EXPORT_DIR/dwca/: the zip GBIF crawls (salishsea-occurrences-v1.zip), its
 * GeoParquet sidecar, and a sha256 checksum beside each, as the nightly workflow published
 * them from Postgres, after the nightly's own checks (the artifact contract and the
 * floors).
 * The archive writer is the nightly's own (scripts/dwca/build.ts's writeArchive); what
 * changes is where `pgdb.dwc.*` comes from: derive/dwc.sql's twins of Postgres's views,
 * over the snapshot and the build's mirrors, with the same lookups and extractions the
 * occurrences use. The directory is replaced whole, so a reader never sees half an
 * archive.
 *
 * Dated by the snapshot's UTC day (snapshot.day), as Postgres's CURRENT_DATE dated it:
 * the same data on the same day is the same bytes.
 */

import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import * as path from 'node:path';

import { writeArchive } from '../dwca/build.ts';
import { floorsFromEnv } from '../dwca/guard.ts';
import { verifyArtifact } from '../dwca/verify-artifact.ts';
import { writeMaplifyEntities } from './derive/maplify-entities.ts';
import { attachSources, mirrorArgs, type Mirrors } from './derive/sources.ts';
import { budget } from './duckdb-budget.ts';
import { recoverDir, replaceDir } from './replace-dir.ts';

/**
 * Run `use` on a connection holding the archive's relations under `pgdb` (derive/dwc.sql),
 * derived from the snapshot and the mirrors.
 */
export async function withDwc<T>(
    snapshot: string, mirrors: Mirrors, use: (conn: DuckDBConnection) => Promise<T>,
): Promise<T> {
    const sql = async (file: string) => readFile(new URL(`./derive/${file}`, import.meta.url), 'utf8');
    const db = await DuckDBInstance.create(':memory:');
    const conn = await db.connect();
    try {
        await budget(conn, snapshot, '128MB');
        await conn.run(`INSTALL icu; LOAD icu; SET TimeZone = 'UTC'`);
        await conn.run(`ATTACH '${snapshot.replaceAll("'", "''")}' AS store (READ_ONLY)`);
        await conn.run('USE store');
        await attachSources(conn, mirrors);
        await conn.run(await sql('extract.sql'));
        await conn.run(await sql('shared.sql'));
        await conn.run(await sql('lookups.sql'));
        await writeMaplifyEntities(conn);
        // snapshot.day, not snapshot.meta's moment: the archive changes with its data or
        // the date, not with every build.
        const day = (await conn.runAndReadAll('SELECT day FROM snapshot.day')).getRows()[0]![0] as string;
        await conn.run(`SET VARIABLE pub_date = '${day}'`);
        await conn.run(await sql('dwc.sql'));
        return await use(conn);
    } finally {
        conn.closeSync();
        db.closeSync();
    }
}

/** The published files, at the paths GBIF and the about page already know. */
const ZIP = 'salishsea-occurrences-v1.zip';
const PARQUET = 'salishsea-occurrences-v1.parquet';

export async function writeDwca(snapshot: string, mirrors: Mirrors, exportDir: string): Promise<number> {
    const outDir = path.join(exportDir, 'dwca');
    await recoverDir(outDir);
    const staging = await mkdtemp(path.join(exportDir, '.dwca-'));
    try {
        const occurrences = await withDwc(snapshot, mirrors, conn => writeArchive(conn, staging));
        // What the nightly checked before publishing, checked before this archive replaces
        // the last one: the artifact's contract (SC#2-4), then the size and row floors (G-02).
        await verifyArtifact({
            occurrencePath: path.join(staging, 'occurrence.txt'),
            emlPath: path.join(staging, 'eml.xml'),
        });
        const floors = floorsFromEnv();
        const size = async (f: string) => (await stat(path.join(staging, f))).size;
        if (await size(ZIP) <= floors.zipBytes || await size(PARQUET) <= floors.parquetBytes
            || BigInt(occurrences) <= floors.rows) {
            throw new Error(`dwca: under its floors (zip ${await size(ZIP)} B, parquet ${await size(PARQUET)} B, `
                + `${occurrences} rows; floors ${floors.zipBytes} B, ${floors.parquetBytes} B, ${floors.rows} rows)`);
        }
        // The files the nightly published, each with a sha256sum-style checksum beside it.
        // One at a time, so the zip and the parquet are never both in memory.
        await replaceDir(outDir, (async function* () {
            for (const f of [ZIP, PARQUET]) {
                const bytes = await readFile(path.join(staging, f));
                yield [f, bytes] as [string, Uint8Array];
                yield [`${f}.sha256`, `${createHash('sha256').update(bytes).digest('hex')}  ${f}\n`] as [string, string];
            }
        })());
        return occurrences;
    } finally {
        await rm(staging, {recursive: true, force: true});
    }
}

export async function main(): Promise<void> {
    const [snapshot, ...rest] = process.argv.slice(2);
    const mirrors = mirrorArgs(rest);
    const exportDir = process.env['EXPORT_DIR'];
    if (!snapshot || !mirrors || !exportDir) {
        console.error('usage: EXPORT_DIR=… dwca.ts <snapshot.duckdb> <maplify.sqlite> <inaturalist.sqlite> <orcasound.sqlite>');
        process.exit(2);
    }
    console.log(`dwca/: ${await writeDwca(snapshot, mirrors, exportDir)} occurrences`);
}

if (import.meta.main) {
    await main();
}
