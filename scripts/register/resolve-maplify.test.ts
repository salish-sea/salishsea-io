import { describe, expect, test } from 'vitest';
import { planResolution } from './resolve-maplify.ts';

/**
 * The refusal rule of the unattended re-resolve (decision 049): after a register load, a
 * record may gain an entity or move to a better one, but never lose the one it has. An
 * edition that dropped a name must turn register-refresh red, not quietly un-name records.
 */
const row = (name: string, entity_id: string | null, n = 1) =>
    ({ name, scientific_name: '', entity_id, n });

describe('planResolution', () => {
    test('a record that would lose its entity is refused', () => {
        const { losing } = planResolution([row('Gray', 'SSA:0000905', 141)], () => null);
        expect(losing.map((c) => c.row.name)).toEqual(['Gray']);
    });

    test('gaining an entity, or moving to another, is a change and not a loss', () => {
        const resolve = (r: { name: string | null }) => (r.name === 'Beluga' ? 'SSA:0000953' : 'SSA:0000010');
        const { changes, losing } = planResolution(
            [row('Beluga', null), row('Southern Resident Killer Whale', 'SSA:0000003')], resolve);
        expect(changes).toHaveLength(2);
        expect(losing).toEqual([]);
    });

    test('an unchanged record is not a change, so nothing is rewritten', () => {
        const { changes } = planResolution([row('Orca', 'SSA:0000900')], () => 'SSA:0000900');
        expect(changes).toEqual([]);
    });

    test('an unidentified record that stays unidentified is not a loss', () => {
        const { changes, losing } = planResolution([row('Unspecified', null, 1453)], () => null);
        expect(changes).toEqual([]);
        expect(losing).toEqual([]);
    });
});
