/**
 * Decide which storage objects the media mirror still needs
 * (salish-5xy, [decision 038](../../docs/decisions/038-nightly-backups-we-own.md)).
 *
 * WHY THIS EXISTS. `pg_dump` captures `storage.objects` — the rows describing
 * the photos — and not one byte of the photos themselves. Those live in
 * Supabase's object store, and for a contributor's sighting photo there is no
 * upstream to re-fetch from: it exists there and, once this runs, here.
 *
 * WHY IT IS INCREMENTAL. Copying all of it nightly is the obvious approach and
 * the wrong one on this plan. The bucket is ~104 MB today; pulling it 30 times a
 * month is ~3 GB against a free tier that allows 5 GB of egress in total. The
 * backup would quietly consume most of the project's monthly allowance to
 * re-download bytes it already has, and would grow to breach it. Sighting photos
 * are also written once and never edited, so nearly every one of those bytes is
 * a byte we already hold.
 *
 * So: compare what the database says exists against what the mirror already
 * holds, and name only the difference. Identity is `name` plus the object's
 * ETag, which Supabase stores in `metadata`; an object re-uploaded under the
 * same name gets a new ETag and is fetched again.
 *
 * WHY A MANIFEST RATHER THAN S3's OWN ETag. The obvious comparison — Supabase's
 * ETag against the mirrored object's ETag in S3 — works only while every object
 * is small enough for S3 to store it in one part. Above the multipart threshold
 * S3's ETag stops being the MD5 of the content and becomes a digest of digests
 * with a `-N` suffix, which can never equal Supabase's. The largest photo today
 * is 7.6 MB against an 8 MB threshold, so that comparison is one ordinary
 * upload away from failing — and failing *silently*, by declaring every object
 * changed and re-downloading the whole bucket nightly, which looks exactly like
 * a working backup right up until the egress bill.
 *
 * So the mirror records what it holds in its own manifest, and the comparison is
 * between two values that came from the same system. The S3 listing is still
 * consulted, to catch a manifest that claims an object the bucket does not
 * actually have.
 *
 * Deletions are nobody's business here. The mirror never removes anything: an
 * object deleted upstream is precisely the one you want the backup to still
 * hold, and a mistaken deletion is among the things this exists to survive. So
 * the mirror is append-and-update, and an object dropped upstream simply stops
 * appearing in `expected` while its mirrored copy stays.
 *
 * Usage:
 *   SUPABASE_DB_URL=... npx tsx scripts/backup/plan-media-sync.ts <plan.json> [manifest.json] [keys.txt]
 *
 * Writes `<plan.json>` — what to download, and the full expected inventory —
 * and `<plan.json>.manifest`, which the workflow uploads only after the sweep
 * succeeds.
 */

import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import postgres from 'postgres';

const FAIL = 1;
const USAGE = 2;

/** The one bucket this project has. Named rather than discovered, so a new one appearing is a decision someone makes rather than a silent change in what gets backed up. */
export const MEDIA_BUCKET = 'media';

export interface StorageObject {
  name: string;
  etag: string | null;
  size: number;
}

export interface SyncPlan {
  /** Everything the database says the bucket holds. */
  expected: StorageObject[];
  /** The subset not already mirrored, or mirrored under a different ETag. */
  fetch: StorageObject[];
  /** Bytes the fetch will move. */
  fetchBytes: number;
}

/**
 * @param held    name to upstream ETag, from the mirror's own manifest.
 * @param present keys the S3 listing actually reports under the media prefix.
 *
 * Both are required to consider an object mirrored. The manifest says what was
 * *meant* to be there and the listing says what is; an object in the manifest
 * and not the bucket — a sweep that died between upload and manifest write, a
 * lifecycle rule someone widened — is fetched again rather than assumed.
 *
 * ETags are unquoted on both sides before comparison: Supabase stores them
 * quoted and a manifest round-tripped through other tools may not be.
 */
export function planSync(
  expected: StorageObject[],
  held: Map<string, string>,
  present: Set<string>,
): SyncPlan {
  const unquote = (etag: string | null) => etag?.replace(/^"|"$/g, '') ?? null;
  const fetch = expected.filter(object => {
    if (!present.has(object.name)) return true;
    const mirrored = unquote(held.get(object.name) ?? null);
    const upstream = unquote(object.etag);
    // No ETag either side means we cannot prove it is the same object. Fetch it:
    // a redundant download is cheap, a silently stale photo is not.
    if (!mirrored || !upstream) return true;
    return mirrored !== upstream;
  });
  return {expected, fetch, fetchBytes: fetch.reduce((sum, o) => sum + o.size, 0)};
}

export async function listUpstream(dbUrl: string): Promise<StorageObject[]> {
  const sql = postgres(dbUrl, {prepare: false});
  try {
    const rows = await sql<{name: string; etag: string | null; size: string | null}[]>`
      SELECT name,
             metadata->>'eTag' AS etag,
             metadata->>'size' AS size
      FROM storage.objects
      WHERE bucket_id = ${MEDIA_BUCKET}
      ORDER BY name
    `;
    return rows.map(row => ({
      name: row.name,
      etag: row.etag,
      size: row.size ? Number(row.size) : 0,
    }));
  } finally {
    await sql.end();
  }
}

/**
 * The mirror's manifest, or an empty one.
 *
 * Anything unexpected — missing, unparseable, not an object, a value that is not
 * a string — becomes "nothing is mirrored", which fetches everything. That is
 * the safe direction, and it is the only one available: a half-trusted manifest
 * would have this script compare an ETag against a number and decide something
 * about a photo on the strength of it.
 */
export function readManifest(path: string | undefined): Record<string, string> {
  if (!path) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (!entries.every(([, value]) => typeof value === 'string')) return {};
  return Object.fromEntries(entries) as Record<string, string>;
}

function readLines(path: string): string[] {
  try {
    return readFileSync(path, 'utf-8').split('\n').map(line => line.trim());
  } catch {
    return [];
  }
}

export async function main() {
  const out = process.argv[2];
  if (!out) {
    console.error('Usage: SUPABASE_DB_URL=... npx tsx scripts/backup/plan-media-sync.ts <plan.json> [manifest.json] [keys.txt]');
    process.exit(USAGE);
  }
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error('SUPABASE_DB_URL is required.');
    process.exit(USAGE);
  }

  // Both inputs come from the workflow as files, so this script needs no AWS
  // credentials of its own and stays testable without them. A missing or
  // unreadable manifest means "mirror nothing yet", which fetches everything —
  // the safe direction on the first run and after any loss of the manifest.
  const held = new Map<string, string>(Object.entries(readManifest(process.argv[3])));
  const present = new Set<string>(
    (process.argv[4] ? readLines(process.argv[4]) : []).filter(Boolean)
  );

  const expected = await listUpstream(dbUrl);
  const plan = planSync(expected, held, present);
  await writeFile(out, JSON.stringify(plan, null, 2));
  // The manifest the sweep will write once the upload succeeds — never before,
  // so a failed sweep leaves the previous manifest describing what is really there.
  await writeFile(
    `${out}.manifest`,
    JSON.stringify(Object.fromEntries(expected.map(o => [o.name, o.etag ?? ''])), null, 2)
  );

  console.log(
    `media: ${expected.length} objects upstream, ${present.size} in the mirror, ` +
    `${plan.fetch.length} to fetch (${(plan.fetchBytes / 1e6).toFixed(1)} MB)`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(FAIL);
  });
}
