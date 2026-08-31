/**
 * Assert that a nightly dump actually carries the rows the database holds
 * (salish-5xy, [decision 038](../../docs/decisions/038-nightly-backups-we-own.md)).
 *
 * WHY THIS EXISTS. `pg_dump` exiting 0 says the process finished, not that the
 * file is worth keeping. A dump can be short — a table excluded by a flag
 * someone tuned, a schema renamed out from under the filter, a connection that
 * dropped mid-COPY and still flushed a syntactically complete file — and every
 * one of those failures is silent until the day someone needs to restore.
 *
 * So the check is not "is the file plausible" but "does it contain the rows the
 * source says exist", counted per table and compared. That comparison is what a
 * size floor only gestures at: a dump missing `public.observations` entirely is
 * within 1% of the right size, because 501 sightings are a rounding error
 * beside 40,792 Maplify rows.
 *
 * WHAT IT CHECKS
 *
 *   1. Every table in {@link IRREPLACEABLE} appears in the dump with a row count
 *      matching the live database. These are the tables no upstream can give
 *      back: the sightings people typed in themselves, the catalogue, the
 *      accounts, and the photo metadata.
 *   2. Nothing in the dump is *fewer* rows than live for any other table it
 *      carries. Reported, not failed — ingest runs continuously, so a table
 *      gaining rows between the dump and this check is ordinary.
 *   3. The file clears a floor, which catches the degenerate cases (empty file,
 *      an error page, a dump that died before the data section) with a message
 *      that names the actual problem rather than a confusing count mismatch.
 *
 * WHY THE COMPARISON IS A RANGE AND NOT AN EQUALITY. The database is live while
 * the dump runs. Someone submits a sighting, ingest mints a contributor, a
 * photo lands — every one of the "irreplaceable" tables can gain a row mid-dump,
 * so a count taken afterwards will legitimately exceed what the file holds.
 * Requiring equality would fail good backups on ordinary traffic and raise an
 * alarm that says the opposite of the truth, which is how a check earns the
 * right to be ignored.
 *
 * So the caller brackets the dump: counts taken *before* it starts, this script
 * takes counts *after* it finishes, and the dump's own count has to land in
 * between. Anything outside that range is not timing — it is a short dump.
 *
 * With no bracket the comparison is exact, which is right for the case that has
 * no traffic: verifying a restored copy, where the database is static and any
 * difference at all is a defect in the restore.
 *
 * Usage:
 *   SUPABASE_DB_URL=... npx tsx scripts/backup/verify-dump.ts --snapshot <counts.json>
 *   SUPABASE_DB_URL=... npx tsx scripts/backup/verify-dump.ts <data.sql> [before-counts.json]
 */

import { createReadStream, readFileSync } from 'node:fs';
import { stat, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import postgres from 'postgres';

/** Exit codes: 0 the dump is trustworthy, 1 it is not, 2 a usage error. */
const FAIL = 1;
const USAGE = 2;

/**
 * Tables whose contents exist nowhere else. A shortfall in any of these fails
 * the run; everything else in the database can be re-fetched from the API it
 * came from.
 */
const IRREPLACEABLE = [
  'public.observations',
  'public.individuals',
  'public.social_groups',
  'public.designations',
  'public.contributors',
  'auth.users',
  'storage.objects',
] as const;

/** `COPY schema.table (cols) FROM stdin;`, with either part quoted or bare. */
const COPY_HEADER = /^COPY (?:"([^"]+)"|([^\s".]+))\.(?:"([^"]+)"|([^\s".(]+))\s*\(.*\) FROM stdin;$/;

/** Below this the file is not a dump, whatever it is. */
const FLOOR_BYTES = 1_000_000;

/**
 * Row counts per `schema.table`, read out of the COPY blocks in a plain-SQL
 * data dump.
 *
 * The CLI dumps data with `--use-copy`, so each table arrives as
 * `COPY "schema"."table" (...) FROM stdin;`, its rows, then a lone `\.`. Counting
 * the lines between is exact and needs no SQL parsing — but only because COPY
 * data cannot contain a bare newline: pg_dump escapes them as `\n` within a
 * field. A future switch to `INSERT` form (drop `--use-copy`) breaks this, which
 * is why the workflow pins the flag and this comment says so.
 *
 * Identifiers are matched quoted or bare. Real dumps from this pipeline quote
 * both parts, but the CLI passes no `--quote-all-identifiers`, so that is
 * pg_dump's own habit rather than anything we control. Depending on it would
 * mean a pg_dump that changed its mind produced a file where nothing matched —
 * a loud failure, since every table would then read as absent, but a thoroughly
 * misleading one.
 */
export async function countDumpedRows(path: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const lines = createInterface({input: createReadStream(path), crlfDelay: Infinity});
  let current: string | null = null;
  let n = 0;
  for await (const line of lines) {
    if (current === null) {
      const match = COPY_HEADER.exec(line);
      if (match) {
        const schema = match[1] ?? match[2];
        const table = match[3] ?? match[4];
        current = `${schema}.${table}`;
        n = 0;
      }
      continue;
    }
    if (line === '\\.') {
      counts.set(current, (counts.get(current) ?? 0) + n);
      current = null;
      continue;
    }
    n++;
  }
  if (current !== null)
    throw new Error(`Dump ends inside a COPY block for ${current} — it is truncated.`);
  return counts;
}

/**
 * Decides whether a dumped count is consistent with the database.
 *
 * `before` is the count taken before the dump began; without one the bounds
 * collapse to a single number and the check is an equality.
 */
export function judgeCount(
  dumped: number | undefined,
  live: number,
  before: number | undefined,
): string | null {
  if (dumped === undefined)
    return `absent from the dump (${live} rows live). Nothing else has these rows.`;
  const low = before === undefined ? live : Math.min(before, live);
  const high = before === undefined ? live : Math.max(before, live);
  if (dumped < low)
    return `${dumped} rows dumped, but the table held at least ${low} throughout — the dump is short.`;
  if (dumped > high)
    return `${dumped} rows dumped, more than the ${high} the table ever held — rows were deleted after the dump.`;
  return null;
}

async function liveCounts(dbUrl: string): Promise<Record<string, number>> {
  const sql = postgres(dbUrl, {prepare: false});
  try {
    const counts: Record<string, number> = {};
    for (const qualified of IRREPLACEABLE) {
      const [schema, table] = qualified.split('.') as [string, string];
      const [row] = await sql`SELECT count(*)::int AS n FROM ${sql(schema)}.${sql(table)}`;
      counts[qualified] = row!.n as number;
    }
    return counts;
  } finally {
    await sql.end();
  }
}

export async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error('SUPABASE_DB_URL is required.');
    process.exit(USAGE);
  }

  if (process.argv[2] === '--snapshot') {
    const out = process.argv[3];
    if (!out) {
      console.error('Usage: SUPABASE_DB_URL=... npx tsx scripts/backup/verify-dump.ts --snapshot <counts.json>');
      process.exit(USAGE);
    }
    const counts = await liveCounts(dbUrl);
    await writeFile(out, JSON.stringify(counts, null, 2));
    console.log(`Counts before the dump: ${JSON.stringify(counts)}`);
    return;
  }

  const path = process.argv[2];
  if (!path) {
    console.error('Usage: SUPABASE_DB_URL=... npx tsx scripts/backup/verify-dump.ts <data.sql> [before-counts.json]');
    process.exit(USAGE);
  }
  let before: Record<string, number> | undefined;
  if (process.argv[3]) {
    try {
      before = JSON.parse(readFileSync(process.argv[3], 'utf-8')) as Record<string, number>;
    } catch (err) {
      // Not survivable: without the lower bound the check silently becomes an
      // equality against a moving database, and starts failing good backups.
      console.error(`Could not read the pre-dump counts at ${process.argv[3]}: ${String(err)}`);
      process.exit(USAGE);
    }
  }

  const problems: string[] = [];

  const {size} = await stat(path);
  if (size < FLOOR_BYTES)
    problems.push(`${path} is ${size} bytes, below the ${FLOOR_BYTES}-byte floor — this is not a complete dump.`);

  const dumped = await countDumpedRows(path);
  if (dumped.size === 0)
    problems.push(`${path} contains no COPY blocks at all — no table data was dumped.`);

  const live = await liveCounts(dbUrl);
  for (const qualified of IRREPLACEABLE) {
    const inDump = dumped.get(qualified);
    const problem = judgeCount(inDump, live[qualified]!, before?.[qualified]);
    if (problem) problems.push(`${qualified}: ${problem}`);
    else console.log(`  ${qualified}: ${inDump} rows`);
  }

  const total = [...dumped.values()].reduce((a, b) => a + b, 0);
  console.log(`${path}: ${dumped.size} tables, ${total} rows, ${(size / 1e6).toFixed(1)} MB`);

  if (problems.length) {
    console.error('\nThis dump is not trustworthy:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(FAIL);
  }
  console.log('Dump carries every irreplaceable table at its live row count.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(FAIL);
  });
}
