/**
 * Deterministic zip writer for the DarwinCore Archive output.
 *
 * Thin `yazl` wrapper that pins every entry's modification timestamp to a
 * fixed epoch (`FIXED_MTIME`, 2000-01-01 UTC) and preserves the input
 * entry order, so identical inputs produce byte-identical zip files. The
 * deterministic-output property is what lets Phase 7 (publishing) detect
 * "no upstream change" via a content hash and skip re-uploading.
 *
 * Belt-and-suspenders path-traversal guard rejects six categories of
 * malformed entry names even though Plan 05's `build.ts` only ever
 * passes hardcoded names (`occurrence.txt`, `multimedia.txt`,
 * `meta.xml`, `eml.xml`). Defense in depth: a regression in `build.ts`
 * that interpolates user data into a zip entry name fails here, not in
 * a consumer that downloads and extracts the archive.
 *
 * Cross-reference: see `.planning/phases/06-archive-generation/06-CONTEXT.md`
 * `<decisions>` Claude's Discretion for the zip filename and internal entry
 * names; see 06-RESEARCH.md §T6 for the determinism claim under test.
 */

import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import yazl from 'yazl';

/**
 * Fixed modification timestamp embedded in every zip entry header.
 * `2000-01-01T00:00:00Z` is `946684800000` ms since epoch. Held constant
 * so two runs of `writeZip` with identical content produce byte-identical
 * archive files.
 */
export const FIXED_MTIME = new Date('2000-01-01T00:00:00Z');

/**
 * One entry in the zip. `name` is the in-archive path (e.g. `occurrence.txt`);
 * `content` is the raw bytes. `writeZip` rejects path-traversal patterns in
 * `name` before adding to the zip.
 */
export interface ZipEntry {
    readonly name: string;
    readonly content: Buffer;
}

/**
 * Six categories of malformed zip entry name. Rejected before any bytes
 * are written. The combined check yields a single error message —
 * `'Invalid zip entry name: <name>'` — that includes the offending input
 * for grep-friendly debugging.
 */
function validateEntryName(name: string): void {
    const invalid =
        name === '' ||
        name.includes('..') ||
        name.includes('\0') ||
        name.startsWith('/') ||
        name.startsWith('\\');
    if (invalid) {
        throw new Error(`Invalid zip entry name: ${name}`);
    }
}

/**
 * Writes a deterministic zip file at `outPath` containing the given
 * entries, in input order. Each entry's modification time is forced to
 * `FIXED_MTIME`. Creates the parent directory of `outPath` recursively
 * if it does not exist. Rejects any entry whose `name` would allow a
 * directory traversal on extraction.
 *
 * Returns void on success; rethrows any underlying mkdir / pipeline /
 * write-stream error.
 */
export async function writeZip(
    outPath: string,
    files: readonly ZipEntry[],
): Promise<void> {
    for (const file of files) {
        validateEntryName(file.name);
    }

    await mkdir(dirname(outPath), { recursive: true });

    const zip = new yazl.ZipFile();
    for (const file of files) {
        zip.addBuffer(file.content, file.name, {
            mtime: FIXED_MTIME,
            compress: true,
        });
    }
    zip.end();

    await pipeline(zip.outputStream, createWriteStream(outPath));
}
