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
 * A COUNT DRIFTING UP IS NOT A FAILURE. Ingest writes while the dump runs, so
 * live > dumped is expected for `maplify.sightings` and
 * `inaturalist.observations`. Live < dumped would mean rows disappeared between
 * the two, which is worth saying out loud but is not this script's business.
 * Only the irreplaceable tables are held to an exact match, and they are the
 * ones nothing writes to unattended.
 *
 * Usage:
 *   SUPABASE_DB_URL=... npx tsx scripts/backup/verify-dump.ts <data.sql>
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
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
 */
export async function countDumpedRows(path: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const lines = createInterface({input: createReadStream(path), crlfDelay: Infinity});
  let current: string | null = null;
  let n = 0;
  for await (const line of lines) {
    if (current === null) {
      const match = /^COPY "([^"]+)"\."([^"]+)" .* FROM stdin;$/.exec(line);
      if (match) {
        current = `${match[1]}.${match[2]}`;
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

export async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: SUPABASE_DB_URL=... npx tsx scripts/backup/verify-dump.ts <data.sql>');
    process.exit(USAGE);
  }
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error('SUPABASE_DB_URL is required.');
    process.exit(USAGE);
  }

  const problems: string[] = [];

  const {size} = await stat(path);
  if (size < FLOOR_BYTES)
    problems.push(`${path} is ${size} bytes, below the ${FLOOR_BYTES}-byte floor — this is not a complete dump.`);

  const dumped = await countDumpedRows(path);
  if (dumped.size === 0)
    problems.push(`${path} contains no COPY blocks at all — no table data was dumped.`);

  const sql = postgres(dbUrl, {prepare: false});
  try {
    for (const qualified of IRREPLACEABLE) {
      const [schema, table] = qualified.split('.') as [string, string];
      const [row] = await sql`
        SELECT count(*)::int AS n FROM ${sql(schema)}.${sql(table)}
      `;
      const live = row!.n as number;
      const inDump = dumped.get(qualified);
      if (inDump === undefined)
        problems.push(`${qualified}: absent from the dump (${live} rows live). Nothing else has these rows.`);
      else if (inDump !== live)
        problems.push(`${qualified}: ${inDump} rows dumped, ${live} live.`);
      else
        console.log(`  ${qualified}: ${inDump} rows`);
    }
  } finally {
    await sql.end();
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
