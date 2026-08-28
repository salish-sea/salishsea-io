/**
 * Load a published edition of the animals register into Postgres (salish-ayb.5).
 *
 * ADR-0012 makes the register authoritative for animal identity and this application a
 * materialization of it. ADR-0013/0014 make it a *publication*: artefacts hang off a
 * release tag, with SHA256SUMS alongside, and a consumer records the tag and the digest
 * it verified.
 *
 * So this loads from a release, never from a working tree. A checkout can be dirty, ahead
 * of what was published, or mid-edit; a tag cannot. The digest is checked before anything
 * is written, and stored, so `register.edition` answers "which claims are these?" when a
 * name later changes.
 *
 * Idempotent: the load replaces the schema's contents in one transaction. Re-running the
 * same tag is a no-op in effect.
 *
 * Usage:
 *   SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *     npx tsx scripts/register/load.ts --tag 2026.08.1            # dry run
 *   ... npx tsx scripts/register/load.ts --tag 2026.08.1 --apply  # writes
 *   ... npx tsx scripts/register/load.ts --tag 2026.08.1 --emit-sql > register.sql
 *
 * --emit-sql exists because production has no direct connection from a laptop; the
 * statements go through `supabase db query --linked`.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import postgres from 'postgres';

const REPO = 'salish-sea/animals';
const RELEASE = (tag: string, asset: string) =>
    `https://github.com/${REPO}/releases/download/${tag}/${asset}`;

/** Columns as published, in file order. The loader does not reorder or rename. */
const TABLES = [
    ['entities', ['entity_id', 'kind', 'rank', 'label', 'taxon_id', 'born', 'sex', 'source_id', 'note']],
    ['names', ['entity_id', 'name', 'type', 'language', 'source_id', 'note']],
    ['mappings', ['subject_id', 'predicate_id', 'object_id', 'object_label',
        'mapping_justification', 'confidence', 'source_id', 'note']],
] as const;

/**
 * A SQL string literal, or NULL.
 *
 * Doubling the quote is sufficient because `standard_conforming_strings` is on — the
 * server default, and not overridden here — so a backslash in a name is data rather than
 * an escape. Values reaching this are register names and notes; a tab would already have
 * been rejected as a ragged row.
 */
function lit(v: string | null): string {
    return v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`;
}

/** Parse a published TSV. Empty string means NULL — the register writes no sentinel. */
function parseTsv(text: string, columns: readonly string[]): (string | null)[][] {
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

async function main(): Promise<void> {
    const argv = process.argv;
    const tag = argv[argv.indexOf('--tag') + 1];
    if (!argv.includes('--tag') || !tag || tag.startsWith('--')) {
        console.error('--tag <release> is required, e.g. --tag 2026.08.1');
        process.exit(2);
    }
    const apply = argv.includes('--apply');
    const emitSql = argv.includes('--emit-sql');
    if (apply && emitSql) {
        console.error('--apply and --emit-sql are mutually exclusive: one writes, the other prints.');
        process.exit(2);
    }
    const say = emitSql ? console.error : console.log;

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

    // Store the digest of the artefact we actually downloaded and verified. Recording
    // register.db's instead would look more canonical and attest nothing: that file is
    // never fetched here, so if a release's TSVs and database ever diverged, the stored
    // digest would describe content this schema does not contain.

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

        const parsed = TABLES.map(([name, columns]) => {
            const rows = parseTsv(readFileSync(path.join(dir, 'data', `${name}.tsv`), 'utf8'), columns);
            say(`  ${name}: ${rows.length} rows`);
            return { name, columns, rows };
        });

        // Statements, in FK order, WITHOUT the transaction wrapper: postgres.js refuses a
        // multi-statement BEGIN/COMMIT on a pooled connection, so the direct path uses
        // sql.begin and only the emitted SQL carries the wrapper. Either way the load is
        // one transaction, so a failure leaves the previous edition in place rather than
        // an empty schema the app would render as a blank map.
        const statements: string[] = [];
        for (const { name } of [...parsed].reverse()) statements.push(`DELETE FROM register.${name};`);
        for (const { name, columns, rows } of parsed)
            for (let i = 0; i < rows.length; i += 200) {
                const chunk = rows.slice(i, i + 200);
                statements.push(
                    `INSERT INTO register.${name} (${columns.join(', ')}) VALUES `
                    + chunk.map((r) => `(${r.map(lit).join(', ')})`).join(', ') + ';',
                );
            }
        statements.push(
            'INSERT INTO register.edition (singleton, tag, sha256, loaded_at) '
            + `VALUES (true, ${lit(tag)}, ${lit(digest)}, now()) `
            + 'ON CONFLICT (singleton) DO UPDATE SET tag = EXCLUDED.tag, '
            + 'sha256 = EXCLUDED.sha256, loaded_at = EXCLUDED.loaded_at;',
        );
        if (emitSql) {
            process.stdout.write(['BEGIN;', ...statements, 'COMMIT;'].join('\n') + '\n');
            return;
        }
        if (!apply) {
            say(`\n${statements.length} statements. Dry run; pass --apply to write.`);
            return;
        }

        const dsn = process.env['SUPABASE_DB_URL'];
        if (!dsn) {
            console.error('SUPABASE_DB_URL is not set (or use --emit-sql)');
            process.exit(1);
        }
        const sql = postgres(dsn);
        try {
            await sql.begin(async (tx) => {
                for (const statement of statements) await tx.unsafe(statement);
            });
            const [counted] = await sql<{ count: number }[]>`
                SELECT count(*)::int FROM register.entities`;
            say(`\nloaded ${tag}: ${counted?.count ?? 0} entities`);
        } finally {
            await sql.end();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

await main();
