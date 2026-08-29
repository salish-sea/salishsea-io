/**
 * Refresh the iNaturalist taxa mirror against upstream (salish-4hq).
 *
 * WHY ANYTHING NEEDS TO DO THIS
 *
 * resolveTaxonClosure fetches only the taxa we do NOT already hold, and the upsert is
 * ON CONFLICT DO NOTHING, so a taxon row is written at first sighting and upstream is
 * never asked about it again. Every mirrored field then freezes at whatever it was that
 * day: scientific name, common name, rank, parent, and whether the taxon still exists.
 * Changing the upsert fixes nothing, because the row is never offered to it a second
 * time. Something has to go back and ask. This script does, weekly, from
 * .github/workflows/taxa-refresh.yml.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not repoint records. A stored taxon id records what was CLAIMED, by upstream on
 * a mirror row or by a contributor on a native one, and decision 032 resolves a
 * retirement when the taxon is read rather than by rewriting the record. So this writes
 * to one table, and a run cannot move an observation from one animal to another. That is
 * what makes it safe to run unattended.
 *
 * HOW IT ASKS
 *
 * By the `/taxa/{ids}` PATH form, through the ingest's own taxaUrl and parseInatTaxa. On
 * `/taxa` the `id=` QUERY PARAM filters to ACTIVE taxa, so a retired id returns
 * `total_results: 0` with nothing to say it ever existed. The path form returns it
 * flagged `is_active: false` with `current_synonymous_taxon_ids`. Both v1 and v2 behave
 * this way; the difference is the route, not the version (salish-5ds). Sharing the
 * ingest's URL and parser is the point: a refresh that asked upstream a different
 * question than the ingest asks would reintroduce drift while looking like the cure.
 *
 * Idempotent: a second run reports nothing to do.
 *
 * Usage:
 *   SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
 *     npx tsx scripts/backfill/inat-taxa-status.ts            # dry run
 *   ... npx tsx scripts/backfill/inat-taxa-status.ts --apply  # writes
 *
 * Against production, prefer the workflow (`gh workflow run taxa-refresh.yml`). The
 * --plan-from/--emit-sql pair remains for a run from a laptop, which has no direct
 * connection: read the plan with
 *   npx supabase db query --linked "SELECT id, is_active, current_taxon_id, \
 *     scientific_name, vernacular_name, rank::text, parent_id FROM inaturalist.taxa" \
 *     | jq .rows > plan.json
 * then `--plan-from plan.json --emit-sql > refresh.sql` and apply that file.
 */

import postgres from 'postgres';
import { taxaUrl } from '../../supabase/functions/ingest/fetch-inaturalist.ts';
import { parseInatTaxa, type NormalizedTaxon } from '../ingest/inaturalist.ts';

const BATCH = 30;          // iNaturalist caps the id list at ~30
const PAUSE_MS = 1100;     // their stated courtesy limit is 60 requests/minute
const USER_AGENT = 'salishsea.io taxa mirror refresh (+https://salishsea.io)';

/** One row of the mirror: what we currently believe about a taxon. */
type Mirrored = {
    id: number;
    is_active: boolean;
    current_taxon_id: number | null;
    scientific_name: string;
    vernacular_name: string | null;
    rank: string;
    parent_id: number | null;
};

/** The columns this script maintains, in the order the UPDATE writes them. */
const PLAN_COLUMNS = [
    'is_active', 'current_taxon_id', 'scientific_name', 'vernacular_name', 'rank', 'parent_id',
] as const;

/** A SQL string literal, or NULL. */
function lit(v: string | number | boolean | null): string {
    return v === null ? 'NULL' : typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : String(v);
}

/**
 * Read a plan file, refusing anything that is not the shape this script reasons about.
 *
 * The plan arrives from `supabase db query --linked`, so its JSON is not this script's to
 * trust. The dangerous shape is a numeric id serialized as a string: it survives the URL
 * join, iNaturalist answers keyed by the NUMBER, and `upstream.has(t.id)` then misses —
 * so the taxon is reported as one the API did not return and quietly left alone. That is
 * a silent under-refresh, the exact failure this script exists to find. Refuse the file
 * instead, before a single upstream request or a line of emitted SQL.
 */
function parsePlan(text: string): Mirrored[] {
    // What inaturalist.taxa.id actually is. A JSON number that is not an int4 — 1.5,
    // 2147483648 — would survive a bare typeof check and fail only at ::int[], after
    // every upstream request had already been spent.
    const isInt4 = (v: unknown): v is number =>
        typeof v === 'number' && Number.isInteger(v) && v >= -2147483648 && v <= 2147483647;

    const rows: unknown = JSON.parse(text);
    if (!Array.isArray(rows))
        throw new Error('--plan-from expects a JSON array of inaturalist.taxa rows');

    const seen = new Set<number>();
    return rows.map((row, i) => {
        const reject = (what: string) =>
            new Error(`--plan-from row ${i}: ${what} — ${JSON.stringify(row).slice(0, 120)}`);
        if (typeof row !== 'object' || row === null) throw reject('not an object');
        const r = row as Record<string, unknown>;
        if (!isInt4(r['id'])) throw reject('id is not an int4');
        if (typeof r['is_active'] !== 'boolean') throw reject('is_active is not a boolean');
        const current = r['current_taxon_id'] ?? null;
        if (current !== null && !isInt4(current)) throw reject('current_taxon_id is not an int4');
        const parent = r['parent_id'] ?? null;
        if (parent !== null && !isInt4(parent)) throw reject('parent_id is not an int4');
        if (typeof r['scientific_name'] !== 'string') throw reject('scientific_name is not a string');
        if (typeof r['rank'] !== 'string') throw reject('rank is not a string (cast it ::text)');
        const vernacular = r['vernacular_name'] ?? null;
        if (vernacular !== null && typeof vernacular !== 'string')
            throw reject('vernacular_name is not a string');
        // inaturalist.taxa.id is a primary key, so the SQL path cannot produce a
        // duplicate and a plan file should not either. Two rows for one taxon give unnest
        // two source rows for the same t.id, and Postgres then picks one of them for the
        // UPDATE without saying which.
        if (seen.has(r['id'])) throw reject(`id ${r['id']} appears more than once`);
        seen.add(r['id']);
        return {
            id: r['id'], is_active: r['is_active'], current_taxon_id: current,
            scientific_name: r['scientific_name'], vernacular_name: vernacular,
            rank: r['rank'], parent_id: parent,
        };
    });
}

/**
 * Ask upstream about every mirrored taxon, in batches, and normalize with the ingest's
 * own parser. A malformed batch throws rather than being skipped: a 200 whose rows omit
 * `is_active` would otherwise coerce to false and mass-retire the mirror.
 */
async function fetchUpstream(ids: number[]): Promise<Map<number, NormalizedTaxon>> {
    const out = new Map<number, NormalizedTaxon>();
    for (let i = 0; i < ids.length; i += BATCH) {
        const batch = ids.slice(i, i + BATCH);
        const res = await fetch(taxaUrl(batch), { headers: { 'User-Agent': USER_AGENT } });
        if (!res.ok)
            throw new Error(`iNaturalist ${res.status} for ids ${batch[0]}…: ${await res.text()}`);
        const parsed = parseInatTaxa(await res.json());
        if (!parsed.ok)
            throw new Error(`iNaturalist taxa parse failed for ids ${batch[0]}…: ${parsed.error}`);
        for (const t of parsed.taxa) out.set(t.id, t);
        if (i + BATCH < ids.length) await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
    return out;
}

/** What a row should hold after the run, and anything a human should know about it. */
type Planned = { row: Mirrored; notes: string[] };

async function main(): Promise<void> {
    const argv = process.argv;
    const emitSql = argv.includes('--emit-sql');
    const usePlanFile = argv.includes('--plan-from');
    const planFrom = argv[argv.indexOf('--plan-from') + 1];
    if (argv.includes('--apply') && emitSql) {
        console.error('--apply and --emit-sql are mutually exclusive: one writes, the other prints.');
        process.exit(2);
    }
    if (argv.includes('--apply') && usePlanFile) {
        console.error('--apply needs a database. Use --plan-from with --emit-sql and apply the SQL yourself.');
        process.exit(2);
    }
    if (usePlanFile && (!planFrom || planFrom.startsWith('--'))) {
        console.error('--plan-from needs a file path.');
        process.exit(2);
    }

    const dsn = process.env['SUPABASE_DB_URL'];
    if (!usePlanFile && !dsn) {
        console.error('SUPABASE_DB_URL is not set (or pass --plan-from <file>)');
        process.exit(1);
    }
    const apply = argv.includes('--apply');
    // With --emit-sql, stdout carries the statements and nothing else; progress and the
    // plan narration go to stderr so `... > file.sql` is directly runnable.
    const say = emitSql ? console.error : console.log;
    const sql = usePlanFile ? null : postgres(dsn!);

    try {
        const mirrored: Mirrored[] = usePlanFile
            ? parsePlan((await import('node:fs')).readFileSync(planFrom!, 'utf8'))
            : await sql!<Mirrored[]>`
                SELECT id, is_active, current_taxon_id, scientific_name, vernacular_name,
                       rank::text, parent_id
                  FROM inaturalist.taxa ORDER BY id`;
        say(`asking iNaturalist about ${mirrored.length} mirrored taxa (${BATCH} per request)…`);
        const upstream = await fetchUpstream(mirrored.map((t) => t.id));

        const missing = mirrored.filter((t) => !upstream.has(t.id));
        if (missing.length)
            say(`\n${missing.length} taxa the API did not return — left untouched: `
                + missing.map((t) => t.id).join(', '));

        const mirroredIds = new Set(mirrored.map((t) => t.id));
        // Both taxon-to-taxon links are foreign keys into a mirror that holds only the
        // taxa we actually reference, so a target we have never seen cannot be recorded.
        // Fetching it would drag in its whole ancestor chain, which is the ingest's job.
        // A retirement whose replacement we do not hold is still recorded as retired with
        // a null pointer. That is the honest state: the taxon is dead and we do not hold
        // its successor. Decision 032 then shows such a record under its own name.
        const heldOrNull = (id: number | null): number | null =>
            id !== null && mirroredIds.has(id) ? id : null;

        // A rename can collide. inaturalist.taxa.scientific_name is UNIQUE, and upstream
        // can hand a name another mirrored row already holds. Even when that row is being
        // renamed away in the same run, one UPDATE cannot swap the two, because Postgres
        // checks uniqueness per row rather than at end of statement. Withhold the
        // colliding name, report it, and write every other field on the row.
        const nameHolder = new Map(mirrored.map((t) => [t.scientific_name, t.id]));
        // Names this run has already promised to another row. Upstream can hand the same
        // name to two mirrored taxa (it merges taxa as readily as it retires them), and
        // checking only against stored names would let both through: the one UPDATE then
        // writes the value twice, violates the UNIQUE index, and rolls back the whole
        // transaction, losing the retirements it had computed correctly.
        const claimed = new Map<string, number>();

        const planned = new Map<number, Planned>();
        let unmirroredParents = 0;
        for (const m of mirrored) {
            const u = upstream.get(m.id);
            if (!u) { planned.set(m.id, { row: m, notes: [] }); continue; }
            const notes: string[] = [];

            const holder = nameHolder.get(u.scientificName) ?? claimed.get(u.scientificName);
            const renameable = holder === undefined || holder === m.id;
            if (renameable) claimed.set(u.scientificName, m.id);
            else notes.push(`rename to "${u.scientificName}" withheld: taxon ${holder} holds that name`);
            const parentUnreachable =
                u.parentId !== null && heldOrNull(u.parentId) === null && u.parentId !== m.parent_id;
            if (parentUnreachable) unmirroredParents++;
            if (!u.isActive && u.currentTaxonId !== null && heldOrNull(u.currentTaxonId) === null)
                notes.push(`replacement ${u.currentTaxonId} is not mirrored; recorded as retired only`);

            planned.set(m.id, {
                row: {
                    id: m.id,
                    is_active: u.isActive,
                    current_taxon_id: u.isActive ? null : heldOrNull(u.currentTaxonId),
                    scientific_name: renameable ? u.scientificName : m.scientific_name,
                    vernacular_name: u.vernacularName,
                    rank: u.rank,
                    // Ancestry follows upstream only as far as the mirror can reach; the
                    // rest is the ingest's closure to fill, and decision 032 resolves a
                    // retired ancestor at read time.
                    parent_id: heldOrNull(u.parentId) ?? m.parent_id,
                },
                notes,
            });
        }

        // A mutual pair (A->B, B->A) is possible across two upstream swaps, and the only
        // CHECK forbids self-pointing. Read-time resolution would then show each of the
        // pair as the other, which is worse than showing neither. Withhold the offending
        // pointers, so one bad pair costs its own rows instead of the run.
        const inCycle = new Set<number>();
        for (const start of planned.keys()) {
            const seen = new Set<number>([start]);
            let at = planned.get(start)?.row.current_taxon_id ?? null;
            while (at !== null && !seen.has(at)) {
                seen.add(at);
                at = planned.get(at)?.row.current_taxon_id ?? null;
            }
            if (at !== null) seen.forEach((id) => inCycle.add(id));
        }
        if (inCycle.size) {
            say(`\nWARNING: ${inCycle.size} taxa form a replacement cycle upstream `
                + `(${[...inCycle].join(', ')}). Their pointers are left unset; nothing else `
                + 'is affected. A human should decide which taxon wins.');
            for (const id of inCycle) planned.get(id)!.row.current_taxon_id = null;
        }

        // Write wherever the desired end state differs from what is stored — NOT merely
        // where upstream changed. A pointer left by an earlier run, or a cycle already in
        // the database that upstream still agrees with, produces no upstream-driven change
        // at all, and a plan built from "what changed upstream" would leave it in place.
        const differs = (m: Mirrored, p: Mirrored) =>
            PLAN_COLUMNS.some((c) => m[c] !== p[c]);
        const toWrite = mirrored.filter((m) => differs(m, planned.get(m.id)!.row));

        const retired = toWrite.filter((t) => !planned.get(t.id)!.row.is_active && t.is_active);
        say(`\n${toWrite.length} taxa to update; ${retired.length} newly retired upstream`);
        for (const m of toWrite) {
            const p = planned.get(m.id)!;
            const changes = PLAN_COLUMNS
                .filter((c) => m[c] !== p.row[c])
                .map((c) => `${c}: ${JSON.stringify(m[c])} -> ${JSON.stringify(p.row[c])}`);
            say(`  ${m.id}  ${m.scientific_name}`);
            for (const c of changes) say(`      ${c}`);
        }
        // Reported on EVERY run, not only the one where the condition first appears. A
        // retirement we cannot point anywhere stays that way, and a warning that prints
        // once is a warning nobody sees.
        for (const [id, p] of planned) for (const n of p.notes) say(`  NOTE ${id}: ${n}`);
        // Counted rather than listed. iNaturalist mirrors ranks we have no reason to
        // hold, so dozens of taxa have a parent we never fetched. It is the steady state,
        // not a fault, and a per-taxon line every week would bury the notes above.
        if (unmirroredParents)
            say(`\n${unmirroredParents} taxa have an upstream parent we do not mirror; `
                + 'their stored ancestry is left alone for the ingest closure to fill.');

        const desired = toWrite.map((t) => planned.get(t.id)!.row);

        if (emitSql) {
            // The direct path writes inside sql.begin(); the emitted file gets the same
            // guarantee in the only way it can — in the text itself. `supabase db query
            // --linked` sends the whole file as one simple query, which Postgres runs in an
            // implicit transaction block, but `psql -f` gives autocommit per statement.
            // Explicit costs nothing on either route.
            process.stdout.write('BEGIN;\n');
            if (!desired.length) console.error('-- nothing to update');
            else {
                const col = (f: (t: Mirrored) => string | number | boolean | null) =>
                    desired.map((t) => lit(f(t))).join(', ');
                process.stdout.write(
                    'UPDATE inaturalist.taxa t SET is_active = plan.is_active,'
                    + ' current_taxon_id = plan.current_taxon_id,'
                    + ' scientific_name = plan.scientific_name,'
                    + ' vernacular_name = plan.vernacular_name,'
                    + ' rank = plan.rank::inaturalist.rank, parent_id = plan.parent_id'
                    + ' FROM (SELECT * FROM unnest('
                    + `ARRAY[${col((t) => t.id)}]::int[], `
                    + `ARRAY[${col((t) => t.is_active)}]::bool[], `
                    + `ARRAY[${col((t) => t.current_taxon_id)}]::int[], `
                    + `ARRAY[${col((t) => t.scientific_name)}]::text[], `
                    + `ARRAY[${col((t) => t.vernacular_name)}]::text[], `
                    + `ARRAY[${col((t) => t.rank)}]::text[], `
                    + `ARRAY[${col((t) => t.parent_id)}]::int[]`
                    + ') AS u(id, is_active, current_taxon_id, scientific_name, vernacular_name,'
                    + ' rank, parent_id)) AS plan WHERE t.id = plan.id;\n',
                );
            }
            process.stdout.write('COMMIT;\n');
            return;
        }

        if (!apply) {
            say('\nDry run. Pass --apply to write.');
            return;
        }
        // Unreachable without a connection: --apply with --plan-from exits at parse.
        if (!sql) throw new Error('--apply requires SUPABASE_DB_URL');
        if (!desired.length) { say('\nnothing to update'); return; }

        await sql.begin(async (tx) => {
            // One statement, because the CHECK constraint requires a replacement to imply
            // inactive: both columns have to move together.
            await tx`
                UPDATE inaturalist.taxa t
                SET is_active = plan.is_active,
                    current_taxon_id = plan.current_taxon_id,
                    scientific_name = plan.scientific_name,
                    vernacular_name = plan.vernacular_name,
                    rank = plan.rank::inaturalist.rank,
                    parent_id = plan.parent_id
                FROM (
                    -- sql.array(), not a bare interpolated JS array. postgres.js infers an
                    -- unknown type for a plain array, lets the server DESCRIBE the
                    -- parameter (the cast decides it), then serializes each element with
                    -- that type's serializer. The int and text serializers are
                    -- value-faithful; the boolean one is identity based
                    -- (x === true ? t : f, postgres/src/types.js:25), so a JS STRING
                    -- 'true' is not === true and silently becomes 'f'. That wrote every
                    -- taxon inactive once. sql.array() declares the type up front.
                    SELECT * FROM unnest(
                        ${sql.array(desired.map((t) => t.id))}::int[],
                        ${sql.array(desired.map((t) => t.is_active))}::bool[],
                        ${sql.array(desired.map((t) => t.current_taxon_id))}::int[],
                        ${sql.array(desired.map((t) => t.scientific_name))}::text[],
                        ${sql.array(desired.map((t) => t.vernacular_name))}::text[],
                        ${sql.array(desired.map((t) => t.rank))}::text[],
                        ${sql.array(desired.map((t) => t.parent_id))}::int[]
                    ) AS u(id, is_active, current_taxon_id, scientific_name, vernacular_name,
                           rank, parent_id)
                ) AS plan
                WHERE t.id = plan.id`;
        });
        say(`\nupdated ${desired.length} taxa`);
    } finally {
        await sql?.end();
    }
}

await main();
