/**
 * Replacing a directory of read-path files whole (decision 056): the day files,
 * the calendar's month files. Shared so every output swaps the same way.
 *
 * The new directory is built beside the old one and swapped in only once
 * complete, so a run that fails partway leaves the last complete build in place
 * and a reader never sees an empty or half-written directory — which matters
 * because the Fly app serves it straight from here.
 *
 * The swap is two renames, which is not atomic: the directory is absent between
 * them. Making it so would be a publish step's job, not the build's. So is
 * running one build at a time: the caller holds the lock (fly/build.sh).
 */

import { access, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

async function exists(p: string): Promise<boolean> {
    return access(p).then(() => true, () => false);
}

/**
 * A run that died between the two renames left the last complete build in
 * `<dir>.previous` and no `<dir>`. Put it back. Call this before anything that
 * can fail, so a failing run never leaves the directory missing.
 */
export async function recoverDir(outDir: string): Promise<void> {
    const previous = `${outDir}.previous`;
    if (!(await exists(outDir)) && (await exists(previous))) {
        await rename(previous, outDir);
    }
}

/** Replace `outDir` with exactly `files` (name → contents). */
export async function replaceDir(outDir: string, files: Iterable<[string, string]> | AsyncIterable<[string, string]>): Promise<void> {
    const staging = `${outDir}.staging`;
    const previous = `${outDir}.previous`;
    await rm(staging, {recursive: true, force: true});
    await rm(previous, {recursive: true, force: true});
    try {
        await mkdir(staging, {recursive: true});
        // Written as they arrive, so a caller can produce them one at a time
        // rather than hold every file in memory at once.
        for await (const [name, contents] of files) {
            await writeFile(path.join(staging, name), contents);
        }
        const hadPrevious = await rename(outDir, previous).then(() => true, (err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT') return false;
            throw err;
        });
        try {
            await rename(staging, outDir);
        } catch (err) {
            if (hadPrevious) await rename(previous, outDir);
            throw err;
        }
        await rm(previous, {recursive: true, force: true});
    } finally {
        await rm(staging, {recursive: true, force: true});
    }
}
