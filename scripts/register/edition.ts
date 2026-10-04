/**
 * A published edition of the animals register, fetched and verified (salish-ayb.5).
 *
 * ADR-0013/0014 make the register a *publication*: artefacts hang off a release tag, with
 * SHA256SUMS alongside, and a consumer records the tag and the digest it verified. So this
 * reads from a release, never from a working tree. The digest is checked before anything
 * is parsed. Two consumers: load.ts, which writes the edition into Postgres, and
 * check-unnaming.ts, which asks of an edition — before it is loaded — whether it still
 * names everything the map shows (salish-xv35.9.2).
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const REPO = 'salish-sea/animals';
const RELEASE = (tag: string, asset: string) =>
    `https://github.com/${REPO}/releases/download/${tag}/${asset}`;

/**
 * Columns as published, in file order. The loader does not reorder or rename.
 *
 * ORDER IS FK ORDER, and load order depends on it: everything references
 * `register.entities`, so entities is first and the DELETE pass walks this list
 * backwards. Adding a table that references another means putting it after it here.
 *
 * `dir` is the directory inside the tarball. `data/` is what the register asserts;
 * `dist/` is derived from it by the register's own builder and published alongside
 * (ADR-0013 makes dist/ part of the distribution, not a build by-product). We load
 * `ancestor` from dist/ rather than recomputing the closure from `membership`, because a
 * second implementation of someone else's transitive closure drifts from it silently.
 */
export const TABLES = [
    ['data', 'entities', ['entity_id', 'kind', 'rank', 'label', 'taxon_id', 'born', 'sex', 'source_id', 'note']],
    ['data', 'names', ['entity_id', 'name', 'type', 'language', 'source_id', 'note']],
    ['dist', 'current_status', ['entity_id', 'status', 'effective', 'asserted_on', 'recorded', 'source_id']],
    ['data', 'mappings', ['subject_id', 'predicate_id', 'object_id', 'object_label',
        'mapping_justification', 'confidence', 'source_id', 'note']],
    ['data', 'deprecations', ['entity_id', 'reason', 'replaced_by', 'consider', 'date', 'source_id', 'note']],
    ['data', 'membership', ['member_id', 'group_id', 'start', 'end', 'source_id', 'note']],
    ['dist', 'ancestor', ['entity_id', 'ancestor_id', 'depth', 'ancestor_label', 'ancestor_kind', 'ancestor_rank']],
    ['data', 'taxonomic_parent', ['taxon_id', 'parent_id', 'rank', 'scientific_name', 'source_id']],
    ['dist', 'taxon_ancestor', ['taxon_id', 'ancestor_id', 'depth', 'ancestor_rank', 'ancestor_name']],
    ['dist', 'classification', ['entity_id', 'label', 'taxon_id', 'scientific_name', 'taxon_rank',
        'kingdom', 'phylum', 'class', 'order', 'family', 'genus']],
] as const;

export type Table = {name: string, columns: readonly string[], rows: (string | null)[][]};

/** Parse a published TSV. Empty string means NULL — the register writes no sentinel. */
export function parseTsv(text: string, columns: readonly string[]): (string | null)[][] {
    const lines = text.replace(/\n$/, '').split('\n');
    const header = lines[0]!.split('\t');
    if (header.length !== columns.length || columns.some((c, i) => header[i] !== c))
        throw new Error(
            `published columns changed: expected ${columns.join(',')}, got ${header.join(',')}`,
        );
    return lines.slice(1).map((line) => {
        const cells = line.split('\t');
        // A short row means an embedded tab or a dropped trailing column; either way the
        // fields after it are shifted and would load as plausible nonsense.
        if (cells.length !== columns.length)
            throw new Error(`ragged row (${cells.length} of ${columns.length}): ${line.slice(0, 120)}`);
        return cells.map((c) => (c === '' ? null : c));
    });
}

async function download(url: string): Promise<Buffer> {
    // Bounded: a stalled connection should fail the load, not hang it indefinitely.
    const res = await fetch(url, {
        headers: { 'User-Agent': 'salishsea.io register loader' },
        signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
    return Buffer.from(await res.arrayBuffer());
}

/** The TSVs of a tarball already unpacked into `dir`, parsed. */
export function parseEdition(dir: string, say: (msg: string) => void = () => {}): Table[] {
    return TABLES.map(([subdir, name, columns]) => {
        const rows = parseTsv(readFileSync(path.join(dir, subdir, `${name}.tsv`), 'utf8'), columns);
        say(`  ${subdir}/${name}: ${rows.length} rows`);
        return { name, columns, rows };
    });
}

/**
 * Fetch, verify and unpack release `tag`. The caller owns `dir` (the unpacked TSVs, for
 * reading them a second way) and removes it with `rmSync(dir, {recursive: true})`.
 */
export async function fetchEdition(
    tag: string, say: (msg: string) => void,
): Promise<{digest: string, dir: string, tables: Table[]}> {
    say(`fetching register ${tag} from ${REPO}…`);
    const [tarball, sums] = await Promise.all([
        download(RELEASE(tag, 'register-tsv.tar.gz')),
        download(RELEASE(tag, 'SHA256SUMS')).then((b) => b.toString('utf8')),
    ]);

    // Verify before reading, not after: an artefact that fails its digest is not one we
    // parse looking for something useful.
    const digest = createHash('sha256').update(tarball).digest('hex');
    const expected = sums.split('\n')
        .map((l) => l.trim().split(/\s+/))
        .find(([, name]) => name === 'register-tsv.tar.gz')?.[0];
    if (!expected) throw new Error('SHA256SUMS does not list register-tsv.tar.gz');
    if (digest !== expected)
        throw new Error(`digest mismatch for register-tsv.tar.gz: got ${digest}, published ${expected}`);
    say(`  digest ok: ${digest.slice(0, 16)}…`);

    const dir = mkdtempSync(path.join(tmpdir(), 'register-'));
    try {
        const untar = spawnSync('tar', ['xzf', '-', '-C', dir], { input: tarball });
        // spawnSync reports a failure to launch in `error` and a non-zero exit in
        // `status`; an empty stderr is a string, not nullish, so `??` would swallow both.
        if (untar.error) throw new Error(`tar could not run: ${untar.error.message}`);
        if (untar.status !== 0)
            throw new Error(
                `tar exited ${untar.status}: ${untar.stderr?.toString().trim() || '(no output)'}`,
            );
        return { digest, dir, tables: parseEdition(dir, say) };
    } catch (error) {
        rmSync(dir, { recursive: true, force: true });
        throw error;
    }
}
