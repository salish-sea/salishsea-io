import { describe, expect, test } from 'vitest';

import { withMacros } from './sql-macros.ts';

/**
 * A Happywhale encounter's local time and zone, as an instant (salish-tyse): the build's
 * twin macro must answer what Postgres's derived.happywhale_instant did, rendered as the
 * documents render it, captured before Postgres retired (salish-9uu.11). Each zone form
 * Happywhale uses, and the daylight-saving edges, where the two engines' time-zone code
 * could differ.
 */
const CASES: [string, string, string][] = [
    ["2025-02-23 13:01:38", "-07:00", "2025-02-23T20:01:38+00:00"],
    ["2025-02-23 13:01:38", "+02:00", "2025-02-23T11:01:38+00:00"],
    ["2025-02-23 13:01:38", "+11:00", "2025-02-23T02:01:38+00:00"],
    ["2025-02-23 13:01:38", "Z", "2025-02-23T13:01:38+00:00"],
    ["2025-02-23 13:01:38", "America/Vancouver", "2025-02-23T21:01:38+00:00"],
    ["2025-07-04 12:00:00", "America/Los_Angeles", "2025-07-04T19:00:00+00:00"],
    ["2025-03-09 02:30:00", "America/Los_Angeles", "2025-03-09T10:30:00+00:00"],   // in the spring-forward gap
    ["2025-11-02 01:30:00", "America/Los_Angeles", "2025-11-02T09:30:00+00:00"],   // in the fall-back overlap
    ["2025-06-01 12:00:00", "Etc/GMT-3", "2025-06-01T09:00:00+00:00"],   // IANA's own POSIX-signed names
    ["2025-06-01 12:00:00", "Etc/GMT+9", "2025-06-01T21:00:00+00:00"],
    ["2025-06-01 23:59:59", "Pacific/Honolulu", "2025-06-02T09:59:59+00:00"],
];

/** The twin, as derive/occurrences.sql defines it, rendered by derive/shared.sql's pg_ts. */
async function twin(): Promise<(local: string, zone: string) => Promise<string>> {
    const query = await withMacros('shared.sql', 'occurrences.sql');
    return async (local, zone) =>
        await query(`SELECT pg_ts(happywhale_instant(CAST($local AS TIMESTAMP), $zone))`, {local, zone}) as string;
}

describe('the twin', () => {
    test('reads a bare offset with ISO 8601\'s sign: 13:01:38 at -07:00 is 20:01:38Z', async () => {
        expect(await (await twin())('2025-02-23 13:01:38', '-07:00')).toBe('2025-02-23T20:01:38+00:00');
    });
});

describe('the twin answers what Postgres did', () => {
    test.each(CASES)('%s at %s', async (local, zone, instant) => {
        expect(await (await twin())(local, zone)).toBe(instant);
    });
});
