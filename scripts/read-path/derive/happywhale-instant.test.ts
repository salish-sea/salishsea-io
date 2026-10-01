import postgres from 'postgres';
import { describe, expect, test } from 'vitest';

import { withMacros } from './sql-macros.ts';

/**
 * A Happywhale encounter's local time and zone, as an instant (salish-tyse): Postgres's
 * derived.happywhale_instant and the build's twin macro must agree, rendered as the
 * documents render it. CI's database holds no Happywhale encounters, so the end-to-end
 * test never reaches this; these cases do. Each zone form Happywhale uses, and the
 * daylight-saving edges, where the two engines' time-zone code could differ.
 */
const CASES: [string, string][] = [
    ['2025-02-23 13:01:38', '-07:00'],
    ['2025-02-23 13:01:38', '+02:00'],
    ['2025-02-23 13:01:38', '+11:00'],
    ['2025-02-23 13:01:38', 'Z'],
    ['2025-02-23 13:01:38', 'America/Vancouver'],
    ['2025-07-04 12:00:00', 'America/Los_Angeles'],
    ['2025-03-09 02:30:00', 'America/Los_Angeles'],   // in the spring-forward gap
    ['2025-11-02 01:30:00', 'America/Los_Angeles'],   // in the fall-back overlap
    ['2025-06-01 12:00:00', 'Etc/GMT-3'],             // IANA's own POSIX-signed names
    ['2025-06-01 12:00:00', 'Etc/GMT+9'],
    ['2025-06-01 23:59:59', 'Pacific/Honolulu'],
];

/** The twin, as derive/occurrences.sql defines it. */
async function twin(): Promise<(local: string, zone: string) => Promise<string>> {
    const query = await withMacros('occurrences.sql');
    return async (local, zone) =>
        await query(`SELECT pg_ts(happywhale_instant(CAST($local AS TIMESTAMP), $zone))`, {local, zone}) as string;
}

describe('the twin', () => {
    test('reads a bare offset with ISO 8601\'s sign: 13:01:38 at -07:00 is 20:01:38Z', async () => {
        expect(await (await twin())('2025-02-23 13:01:38', '-07:00')).toBe('2025-02-23T20:01:38+00:00');
    });
});

const DSN = process.env['SUPABASE_DB_URL'];

describe.skipIf(!DSN)('Postgres and the twin agree (local Supabase)', () => {
    test.each(CASES)('%s at %s', async (local, zone) => {
        const sql = postgres(DSN as string, {prepare: false, max: 1});
        try {
            // Both as text, cast on the server: left to infer, postgres.js sends the local
            // time as a timestamptz, shifted by this machine's own zone.
            const [row] = await sql<{instant: string}[]>`
                SELECT to_jsonb(derived.happywhale_instant(${local}::text::timestamp, ${zone}::text)) #>> '{}' AS instant`;
            expect(await (await twin())(local, zone)).toBe(row!.instant);
        } finally {
            await sql.end();
        }
    });
});
