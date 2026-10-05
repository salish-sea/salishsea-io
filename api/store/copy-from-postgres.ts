/**
 * Copy what users wrote from Postgres into a new store (decision 065, salish-9uu.3.2): the
 * cutover's data move, run once, and before it as often as needed against copies.
 *
 *   SUPABASE_DB_URL=… node api/store/copy-from-postgres.ts <store.db>
 *   node api/store/copy-from-postgres.ts <store.db> --linked <project-ref>
 *
 * The first form reads over a direct connection (a local or CI database). The second asks
 * through the Supabase CLI's linked query, which is how a laptop reaches production. Both
 * run the same queries, as the database owner: the users' Google identities are in
 * `auth`, which no other role reads.
 *
 * It copies the contributors who sign in or own a native sighting, the Google account
 * each user signs in with, their emails, every native sighting and its photos, every
 * feedback message, and every identification. Times become ISO 8601 text in UTC, a
 * location its longitude and latitude. It refuses a store that already holds anything,
 * and copies in one transaction, so a failed copy leaves the store as empty as it found it.
 */

import { execFileSync } from 'node:child_process';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';

import postgres from 'postgres';

import { openStore } from './store.ts';

/** A UTC instant as ISO 8601 text with microseconds and a Z. */
const iso = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
/** A timestamp without zone (Postgres's observations stamp theirs in UTC), likewise. */
const isoNaive = (column: string) => `to_char(${column}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/**
 * A double as its exact eight bytes, in hex: the CLI's path returns JSON text, and this
 * database prints a float to fifteen significant digits (extra_float_digits = 0), which
 * loses the last bits of most coordinates. `exactDouble` turns it back.
 */
const float8 = (expression: string) => `encode(float8send(${expression}), 'hex')`;

/** The contributors a store keeps: those who sign in, and those who own a native sighting. */
const KEPT_CONTRIBUTORS = `(SELECT contributor_id FROM public.user_contributor
                            UNION SELECT contributor_id FROM public.observations WHERE contributor_id IS NOT NULL)`;

/** Each store table, the query that reads it from Postgres, in the order foreign keys need. */
export const COPY: readonly {table: string, query: string}[] = [
    {table: 'contributors', query: `
        SELECT c.id, c.entity_id::text AS entity_id, c.name, c.picture, c.editor, c.orcid
        FROM public.contributors c WHERE c.id IN ${KEPT_CONTRIBUTORS} ORDER BY c.id`},
    {table: 'users', query: `
        SELECT u.id::text AS id, i.provider_id AS google_sub, u.email::text AS email,
               uc.contributor_id, ${iso('u.created_at')} AS created_at
        FROM auth.users u
        JOIN public.user_contributor uc ON uc.user_uuid = u.id
        JOIN auth.identities i ON i.user_id = u.id AND i.provider = 'google'
        ORDER BY u.id`},
    {table: 'contributor_email_addresses', query: `
        SELECT e.email_address::text AS email_address, e.contributor_id
        FROM public.contributor_email_addresses e WHERE e.contributor_id IN ${KEPT_CONTRIBUTORS}
        ORDER BY 1`},
    {table: 'observations', query: `
        SELECT o.id::text AS id, ${iso('o.observed_at')} AS observed_at,
               ${float8('gis.st_x(o.subject_location::gis.geometry)')} AS subject_lon,
               ${float8('gis.st_y(o.subject_location::gis.geometry)')} AS subject_lat,
               ${float8('gis.st_x(o.observer_location::gis.geometry)')} AS observer_lon,
               ${float8('gis.st_y(o.observer_location::gis.geometry)')} AS observer_lat,
               o.body, o.count, o.url, o.direction::text AS direction, o.accuracy, o.contributor_id,
               o.user_uuid::text AS user_id, o.provider_id, o.collection_id, o.source_url, o.entity_id,
               ${isoNaive('o.created_at')} AS created_at, ${isoNaive('o.updated_at')} AS updated_at
        FROM public.observations o ORDER BY o.id`},
    {table: 'observation_photos', query: `
        SELECT p.id, p.observation_id::text AS observation_id, p.seq, p.href, p.license_code
        FROM public.observation_photos p ORDER BY p.id`},
    {table: 'feedback', query: `
        SELECT f.id, ${iso('f.created_at')} AS created_at, f.name, f.email, f.message, f.page_url,
               f.user_agent, f.release, f.user_uuid::text AS user_id,
               CASE WHEN f.notified_at IS NULL THEN NULL ELSE ${iso('f.notified_at')} END AS notified_at,
               f.github_issue
        FROM public.feedback f ORDER BY f.id`},
    {table: 'identifications', query: `
        SELECT i.id, i.occurrence_id, i.individual_id, i.social_group_id, i.is_present,
               i.evidence::text AS evidence, i.method::text AS method, i.status::text AS status,
               i.asserted_by_party_id, i.confidence, i.code, ${iso('i.created_at')} AS created_at,
               i.certainty::text AS certainty
        FROM public.identifications i ORDER BY i.id`},
];

type Row = Record<string, unknown>;
export type Query = (sql: string) => Promise<Row[]>;

/** Over a direct connection, or a transaction on one. */
export function directQuery(sql: {unsafe: (query: string) => PromiseLike<readonly unknown[]>}): Query {
    return async (query) => [...await sql.unsafe(query)] as Row[];
}

/** Through the Supabase CLI's linked query: how a laptop reaches production. */
export function linkedQuery(projectRef: string): Query {
    return async (query) => {
        const out = execFileSync('npx', ['supabase', 'db', 'query', '--linked', '--project-ref', projectRef, query],
            {encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit']});
        const parsed = JSON.parse(out) as {rows?: Row[]};
        if (!Array.isArray(parsed.rows)) throw new Error('supabase db query returned no rows array');
        return parsed.rows;
    };
}

/** ISO 7064 MOD 11-2 over an ORCID's digits, as Postgres's is_valid_orcid checked it. */
export function validOrcid(uri: string): boolean {
    const m = /^https:\/\/orcid\.org\/(\d{4})-(\d{4})-(\d{4})-(\d{3}[\dX])$/.exec(uri);
    if (!m) return false;
    const digits = m.slice(1).join('');
    let total = 0;
    for (const d of digits.slice(0, 15)) total = (total + Number(d)) * 2;
    const check = (12 - (total % 11)) % 11;
    return digits[15] === (check === 10 ? 'X' : String(check));
}

/** The columns sent as `float8` hex, read back as the doubles they were. */
const EXACT_DOUBLES = new Set(['subject_lon', 'subject_lat', 'observer_lon', 'observer_lat']);

export function exactDouble(hex: unknown): number | null {
    if (hex === null || hex === undefined) return null;
    if (typeof hex !== 'string' || !/^[0-9a-f]{16}$/.test(hex)) throw new Error(`not a float8 in hex: ${String(hex)}`);
    return Buffer.from(hex, 'hex').readDoubleBE(0);
}

/** SQLite takes booleans as 0 and 1, and numbers that arrive as strings (bigint, numeric) as numbers. */
function value(v: unknown): SQLInputValue {
    if (v === undefined || v === null) return null;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'bigint') return Number(v);
    return v as SQLInputValue;
}

/** Copy every table into `store`, which must be empty, in one transaction. Returns the counts. */
export async function copyFromPostgres(store: DatabaseSync, query: Query): Promise<Record<string, number>> {
    for (const {table} of COPY) {
        const n = (store.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n: number}).n;
        if (n > 0) throw new Error(`the store's ${table} holds ${n} rows already: the copy goes into an empty store`);
    }
    const rows: Record<string, Row[]> = {};
    for (const {table, query: sql} of COPY) rows[table] = await query(sql);
    for (const c of rows['contributors']!)
        if (c['orcid'] !== null && !validOrcid(String(c['orcid'])))
            throw new Error(`contributor ${String(c['id'])}: ${String(c['orcid'])} is not a valid ORCID`);
    const counts: Record<string, number> = {};
    store.exec('BEGIN');
    try {
        for (const {table} of COPY) {
            const list = rows[table]!;
            counts[table] = list.length;
            if (list.length === 0) continue;
            const columns = Object.keys(list[0]!);
            const insert = store.prepare(
                `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`);
            for (const row of list)
                insert.run(...columns.map(c => EXACT_DOUBLES.has(c) ? exactDouble(row[c]) : value(row[c])));
        }
        store.exec('COMMIT');
    } catch (error) {
        store.exec('ROLLBACK');
        throw error;
    }
    return counts;
}

if (import.meta.main) {
    const args = process.argv.slice(2);
    const at = args.indexOf('--linked');
    const ref = at >= 0 ? args[at + 1] : undefined;
    const [file] = at >= 0 ? args.slice(0, at) : args;
    const dsn = process.env['SUPABASE_DB_URL'];
    if (!file || (at >= 0 && !ref) || (at < 0 && !dsn)) {
        console.error('usage: SUPABASE_DB_URL=… copy-from-postgres.ts <store.db> | copy-from-postgres.ts <store.db> --linked <project-ref>');
        process.exit(2);
    }
    const store = openStore(file);
    const sql = ref ? null : postgres(dsn!, {max: 1});
    try {
        const counts = await copyFromPostgres(store, ref ? linkedQuery(ref) : directQuery(sql!));
        for (const [table, n] of Object.entries(counts)) console.log(`${table}: ${n} rows`);
    } finally {
        store.close();
        await sql?.end();
    }
}
