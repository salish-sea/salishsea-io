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
 *     pnpm -s exec tsx scripts/register/load.ts --tag 2026.09.3            # dry run
 *   ... pnpm -s exec tsx scripts/register/load.ts --tag 2026.09.3 --apply  # writes
 *   ... pnpm -s exec tsx scripts/register/load.ts --tag 2026.09.3 --emit-sql > register.sql
 *
 * --emit-sql exists because production has no direct connection from a laptop; the
 * statements go through `supabase db query --linked`.
 *
 * THE `-s` IS LOAD-BEARING FOR --emit-sql, not a tidiness flag. pnpm prints its own
 * "Already up to date" preamble on stdout, which lands as the FIRST LINE of the emitted
 * SQL and makes it a syntax error at `Already` — after the file looks plausible enough to
 * paste somewhere. Decision 025 makes pnpm the package manager here, so the obvious
 * invocation is the broken one; hence the flag in every line above.
 */

import { rmSync } from 'node:fs';
import postgres from 'postgres';

import { fetchEdition } from './edition.ts';

/**
 * Columns needing quoting in generated SQL. `end` is a reserved word and the column is
 * named for the published one rather than renamed, so every statement touching it has to
 * quote it — including the INSERT column list, which is easy to miss because the table
 * definition quotes it and looks handled.
 */
const RESERVED = new Set(['end', 'order']);
const col = (c: string) => (RESERVED.has(c) ? `"${c}"` : c);

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

    // Fetched, digest-verified and parsed by edition.ts, which check-unnaming.ts shares
    // (salish-xv35.9.2): one reading of a release, whether it is loaded or only asked.
    // Store the digest of the artefact actually downloaded and verified. Recording
    // register.db's instead would look more canonical and attest nothing: that file is
    // never fetched here, so if a release's TSVs and database ever diverged, the stored
    // digest would describe content this schema does not contain.
    const { digest, dir, tables: parsed } = await fetchEdition(tag, say);
    try {

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
                    `INSERT INTO register.${name} (${columns.map(col).join(', ')}) VALUES `
                    + chunk.map((r) => `(${r.map(lit).join(', ')})`).join(', ') + ';',
                );
            }
        statements.push(
            'INSERT INTO register.edition (singleton, tag, sha256, loaded_at) '
            + `VALUES (true, ${lit(tag)}, ${lit(digest)}, now()) `
            + 'ON CONFLICT (singleton) DO UPDATE SET tag = EXCLUDED.tag, '
            + 'sha256 = EXCLUDED.sha256, loaded_at = EXCLUDED.loaded_at;',
        );
        // Our individuals' sex, birth years and life status are the register's (decision
        // 051), copied in the same transaction so they can never lag the edition beside them.
        statements.push('SELECT public.refresh_individual_vitals();');
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
