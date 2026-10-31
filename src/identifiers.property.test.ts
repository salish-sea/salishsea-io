import fc from 'fast-check';
import { describe, expect, test } from 'vitest';

import { withMacros } from '../scripts/read-path/derive/sql-macros.ts';
import { fold } from './fold.ts';
import { detectIndividuals } from './identifiers.ts';

/**
 * Discovery suite (salish-us33): the browser's detectIndividuals, which names the
 * identifiers of a contributor's own sighting until a build publishes it (own-occurrence.ts),
 * against the build's extract_identifiers (derive/extract.sql). ownOccurrence calls its
 * shape an approximation, so order, duplicates and case are compared away: the question is
 * whether the two name the same animals, as the catalogue's fold would match them.
 */
const PIECES = [
    'T', 't', 'J', 'K', 'L', 'CRC', 'crc', 'X',
    '0', '00', '1', '2', '6', '5', '65', '065', '137', 'a', 'A', 'b', 'c', 'f', 'g', 's', 'S',
    '-', ' ', ', ', '.', '/', '(', ')', '_', '\n', 'and',
];
// Non-ASCII letters and digits are left out: derive/extract.sql documents where its \b and
// \p{Nd} part from JavaScript's, and they would drown everything else.
const junk = fc.array(fc.constantFrom(...PIECES), {maxLength: 4}).map(parts => parts.join(''));
// Built to be designation-shaped, so most cases name one: a pod, a separator, leading
// zeros, a digit, more digits or hex, a matriline's s.
const designation = fc.tuple(
    fc.constantFrom('T', 't', 'J', 'K', 'L', 'CRC', 'crc'), fc.constantFrom('', '', '-', ' ', '--'),
    fc.constantFrom('', '0', '00', '000'), fc.stringMatching(/^[0-9a-fA-F]{0,4}$/), fc.constantFrom('', '', 's', 'S'),
).map(parts => parts.join(''));
const text = fc.oneof(
    fc.array(fc.constantFrom(...PIECES), {maxLength: 10}).map(parts => parts.join('')),
    fc.array(fc.oneof(junk, designation), {maxLength: 5}).map(parts => parts.join(' ')),
);
const comparable = (ids: readonly string[] | null) => [...new Set((ids ?? []).map(fold))].sort();

describe('detectIndividuals (discovery)', () => {
    test('names the animals extract_identifiers does', async () => {
        const query = await withMacros('extract.sql');
        const disagreements = new Map<string, [string[], string[]]>();
        let nonEmpty = 0;
        await fc.assert(fc.asyncProperty(text, async body => {
            const sql = comparable(JSON.parse(await query('SELECT CAST(to_json(extract_identifiers($body)) AS VARCHAR)', {body}) as string ?? 'null'));
            const ts = comparable(detectIndividuals(body));
            if (sql.length) nonEmpty++;
            if (JSON.stringify(sql) !== JSON.stringify(ts)) disagreements.set(JSON.stringify(body), [ts, sql]);
        }), {numRuns: 5000});
        console.log(`texts naming an identifier: ${nonEmpty}; disagreements: ${disagreements.size}`);
        expect(Object.fromEntries([...disagreements].slice(0, 25))).toEqual({});
    });
});
