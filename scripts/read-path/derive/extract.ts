/**
 * The two text extractions the occurrence views call, as the build runs them
 * (decision 061): twins of Postgres's `extract_travel_direction` and
 * `extract_identifiers`, which read a sighting's free text for a travel direction
 * and for the designations it names.
 *
 * In TypeScript, not DuckDB SQL, because both rely on Postgres's word-boundary
 * constraints `\m` and `\M`, and DuckDB's regular expressions (RE2) have neither
 * those nor the lookaround that would express them. JavaScript's do, so each
 * pattern here is the Postgres one with the boundaries spelled out.
 *
 * They run before the SQL, over each source's text, into a table the SQL joins
 * (`writeExtractions`). Not as DuckDB scalar functions, which would have read
 * better: node-api's crash the process (SIGSEGV) when DuckDB runs single-threaded,
 * as it does on the one-CPU Fly machine.
 *
 * Twins, not improvements: what Postgres would answer, quirks included, because
 * the build's port is checked against Postgres's stored occurrences row for row.
 * Postgres's word characters are Unicode letters and decimal digits plus `_`
 * (its ICU locale's alnum), so `WORD` is that, not JavaScript's ASCII `\w`; for
 * the same reason `\d` is `\p{Nd}`. And Postgres's case-insensitive flag adds only
 * each letter's own upper and lower case, where JavaScript's `iu` folds Unicode
 * (`ſ` matches `s`, the Kelvin sign `k`), so the patterns spell the cases out
 * instead (`ci`).
 */

import { LIST, VARCHAR, listValue, type DuckDBConnection } from '@duckdb/node-api';

const WORD = String.raw`[\p{L}\p{Nd}_]`;
const NON_WORD = String.raw`[^\p{L}\p{Nd}_]`;
/** A word matched as Postgres's `(?i)` matches it: each ASCII letter in either case, nothing else. */
const ci = (word: string) => word.replace(/[a-z]/g, c => `[${c}${c.toUpperCase()}]`);
/** Postgres's `\m`: a word starts here. */
const WORD_START = `(?<!${WORD})(?=${WORD})`;
/** Postgres's `\M`: a word ends here. */
const WORD_END = `(?<=${WORD})(?!${WORD})`;

/**
 * Postgres: `substring(body FROM '(?i)\m(north(\W*(east|west)|)|(south(\W*(east|west)|))|west|east)(\W*bound)?\M')`,
 * lowered, with every non-word character removed, cast to `travel_direction`.
 * substring() answers with the first parenthesized group, so a trailing "bound" is
 * matched but not kept: "south-westbound" is "southwest".
 */
const EAST_OR_WEST = `(${ci('east')}|${ci('west')})`;
const DIRECTION = new RegExp(
    `${WORD_START}(${ci('north')}(${NON_WORD}*${EAST_OR_WEST}|)|(${ci('south')}(${NON_WORD}*${EAST_OR_WEST}|))|${ci('west')}|${ci('east')})`
    + `(${NON_WORD}*${ci('bound')})?${WORD_END}`,
    'u',
);
const DIRECTIONS = new Set(['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest']);

export function extractTravelDirection(body: string | null): string | null {
    if (body === null) return null;
    const match = DIRECTION.exec(body);
    if (!match) return null;
    const direction = match[1]!.toLowerCase().replace(new RegExp(NON_WORD, 'gu'), '');
    // The cast to the enum, which fails in Postgres on anything else.
    if (!DIRECTIONS.has(direction)) throw new Error(`not a travel_direction: ${JSON.stringify(direction)}`);
    return direction;
}

/**
 * Postgres: every match of `\m(j|k|l|t|crc)[- ]?0*(\d[\da-f]+)(s?)\M`, case-insensitively,
 * in order, each as upper(pod) || digits as written || lower(s). NULL when there are none,
 * as array_agg over no rows is; the views COALESCE that to an empty array.
 */
const IDENTIFIER = new RegExp(
    `${WORD_START}(${['j', 'k', 'l', 't', 'crc'].map(ci).join('|')})[- ]?0*(\\p{Nd}[\\p{Nd}a-fA-F]+)(${ci('s')}?)${WORD_END}`,
    'gu',
);

export function extractIdentifiers(body: string | null): string[] | null {
    if (body === null) return null;
    const found = [...body.matchAll(IDENTIFIER)].map(([, pod, digits, s]) => pod!.toUpperCase() + digits + s!.toLowerCase());
    return found.length > 0 ? found : null;
}

/**
 * Each text the views extract from, keyed as the SQL joins it: the source, and the
 * source row's key as text.
 */
const TEXTS = [
    {source: 'maplify', query: 'SELECT CAST(id AS VARCHAR), comments FROM source_maplify_sightings'},
    {source: 'inaturalist', query: 'SELECT CAST(id AS VARCHAR), description FROM source_inaturalist_observations'},
    {source: 'happywhale', query: 'SELECT CAST(id AS VARCHAR), comments FROM happywhale.encounters'},
    {source: 'native', query: 'SELECT CAST(id AS VARCHAR), body FROM public.observations'},
] as const;

/**
 * Write `extracted(source, key, direction, identifiers)`, one row per text, for the
 * SQL to join where Postgres's views call the two functions. Streamed a chunk at a
 * time; the connection must already be using the snapshot. The table is in the
 * connection's in-memory catalog, so nothing of it lands in the snapshot.
 */
export async function writeExtractions(conn: DuckDBConnection): Promise<void> {
    await conn.run(`CREATE OR REPLACE TABLE memory.main.extracted (
        source VARCHAR, key VARCHAR, direction VARCHAR, identifiers VARCHAR[])`);
    const appender = await conn.createAppender('extracted', 'main', 'memory');
    try {
        for (const {source, query} of TEXTS) {
            const result = await conn.stream(query);
            for await (const rows of result.yieldRows() as AsyncIterable<[string, string | null][]>) {
                for (const [key, text] of rows) {
                    const identifiers = extractIdentifiers(text);
                    appender.appendVarchar(source);
                    appender.appendVarchar(key);
                    const direction = extractTravelDirection(text);
                    if (direction === null) appender.appendNull(); else appender.appendVarchar(direction);
                    if (identifiers === null) appender.appendNull(); else appender.appendList(listValue(identifiers), LIST(VARCHAR));
                    appender.endRow();
                }
            }
        }
        appender.flushSync();
    } finally {
        appender.closeSync();
    }
}
