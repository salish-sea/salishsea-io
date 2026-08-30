/**
 * Assert that the animals register actually reached this database (salish-1g8).
 *
 * WHY THIS EXISTS. `public.occurrences` LEFT JOINs `register.inaturalist_taxon_name`, so
 * an empty `register.*` is not an error — every name simply falls back to iNaturalist's
 * and the map renders exactly as it did before the register was adopted. That fallback is
 * correct (decision 033: a failed load must not blank the map) and it is precisely what
 * makes the failure invisible: "the register never loaded" reads identically to "the
 * register has no name for this animal".
 *
 * Nothing else notices. The loader is run by hand, `supabase db push` will happily create
 * the schema empty, and the 91.5% coverage figure in decision 033 would read 0% in
 * production with no symptom a human would see.
 *
 * WHAT IT CHECKS, in ascending order of how much it proves:
 *
 *   1. `register.edition` holds exactly one row — something was loaded, and we can say
 *      which edition and which digest was verified (animals ADR-0013/0014).
 *   2. `register.entities` and `register.names` are non-empty — the load carried content,
 *      not just an edition marker.
 *   3. Occurrences actually resolve a register entity. This is the real assertion: 1 and
 *      2 can hold while the crosswalk view is broken, the iNaturalist mirror has moved
 *      out from under the join, or a migration has replaced `public.occurrences` with a
 *      definition that no longer reads the register at all.
 *
 * Drift is REPORTED, NOT FAILED. The register is cut on demand, possibly several times a
 * day, so being a release or two behind is the expected state rather than an incident.
 * Being *empty* is the incident.
 *
 * Usage:
 *   SUPABASE_DB_URL=... npx tsx scripts/register/verify.ts
 *   SUPABASE_DB_URL=... npx tsx scripts/register/verify.ts --min-coverage 50
 */

import postgres from 'postgres';

const REPO = 'salish-sea/animals';

/** Exit codes: 0 fine, 1 the register is not usable, 2 a usage error. */
const FAIL = 1;

function arg(name: string): string | undefined {
    const i = process.argv.indexOf(name);
    return i === -1 ? undefined : process.argv[i + 1];
}

/**
 * The newest published release, or null if GitHub cannot be reached.
 *
 * Deliberately non-fatal. This check's job is to prove the database is usable; a rate
 * limit or a network blip on a courtesy comparison must not turn a healthy register into
 * a failed run.
 */
async function latestRelease(): Promise<string | null> {
    try {
        const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
            headers: { accept: 'application/vnd.github+json' },
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) return null;
        const body = await res.json() as { tag_name?: string };
        return body.tag_name ?? null;
    } catch {
        return null;
    }
}

async function main(): Promise<void> {
    const minCoverage = Number(arg('--min-coverage') ?? '1');
    if (!Number.isFinite(minCoverage) || minCoverage < 0 || minCoverage > 100) {
        console.error('--min-coverage takes a percentage between 0 and 100');
        process.exit(2);
    }

    const dsn = process.env['SUPABASE_DB_URL'];
    if (!dsn) {
        console.error('SUPABASE_DB_URL is not set');
        process.exit(2);
    }

    const sql = postgres(dsn);
    const problems: string[] = [];
    try {
        const editions = await sql<{ tag: string; sha256: string; loaded_at: Date }[]>`
            SELECT tag, sha256, loaded_at FROM register.edition`;
        if (editions.length !== 1) {
            problems.push(
                `register.edition holds ${editions.length} rows, expected exactly 1 — ` +
                'nothing has loaded the register into this database ' +
                '(scripts/register/load.ts --tag <release> --apply).',
            );
        }
        const edition = editions[0];
        if (edition) {
            console.log(`edition   ${edition.tag}`);
            console.log(`digest    ${edition.sha256.slice(0, 16)}…`);
            console.log(`loaded    ${edition.loaded_at.toISOString()}`);
        }

        const [counts] = await sql<{ entities: number; names: number; mappings: number }[]>`
            SELECT (SELECT count(*)::int FROM register.entities) AS entities,
                   (SELECT count(*)::int FROM register.names)    AS names,
                   (SELECT count(*)::int FROM register.mappings) AS mappings`;
        console.log(`content   ${counts?.entities ?? 0} entities, ` +
                    `${counts?.names ?? 0} names, ${counts?.mappings ?? 0} mappings`);
        if (!counts?.entities) problems.push('register.entities is empty.');
        if (!counts?.names) problems.push('register.names is empty.');

        // The assertion that actually proves the register is reaching the application.
        // Counting rows in `register.*` says the load ran; this says the join still works.
        const [coverage] = await sql<{ total: number; resolved: number; pct: number }[]>`
            SELECT count(*)::int AS total,
                   count(*) FILTER (WHERE (taxon).entity_id IS NOT NULL)::int AS resolved,
                   COALESCE(round(100.0 * count(*) FILTER (WHERE (taxon).entity_id IS NOT NULL)
                            / NULLIF(count(*), 0), 1), 0)::float8 AS pct
            FROM public.occurrences`;
        console.log(`coverage  ${coverage?.resolved ?? 0} of ${coverage?.total ?? 0} ` +
                    `occurrences resolve a register entity (${coverage?.pct ?? 0}%)`);
        // Only meaningful once the register has content. With an empty `register.*` the
        // coverage is zero as a CONSEQUENCE of the failures above, and reporting it too
        // would read as a second, independent fault — and contradict itself by saying the
        // register "is loaded".
        if (counts?.entities && (coverage?.total ?? 0) > 0
            && (coverage?.pct ?? 0) < minCoverage) {
            problems.push(
                `only ${coverage?.pct ?? 0}% of occurrences resolve a register entity, ` +
                `below the ${minCoverage}% floor — the register is loaded but is not ` +
                'reaching public.occurrences.',
            );
        }

        const latest = await latestRelease();
        if (latest === null) {
            console.log('latest    (could not ask GitHub; drift not checked)');
        } else if (!edition) {
            // Saying "current" here would be a lie about a database holding no edition
            // at all, and it is the one line a reader might skim to.
            console.log(`latest    ${latest} — nothing loaded here to compare it against`);
        } else if (latest !== edition.tag) {
            console.log(`latest    ${latest} — this database is behind. Not an error: ` +
                        'the register is cut on demand and the next refresh will catch up.');
        } else {
            console.log(`latest    ${latest} — current`);
        }
    } finally {
        await sql.end();
    }

    if (problems.length) {
        console.error('\nThe register is not usable in this database:');
        for (const p of problems) console.error(`  - ${p}`);
        console.error(
            '\nThe map does not break when this happens — it silently falls back to ' +
            "iNaturalist's names, which is why this check exists (salish-1g8, decision 033).",
        );
        process.exit(FAIL);
    }
    console.log('\nregister ok');
}

await main();
