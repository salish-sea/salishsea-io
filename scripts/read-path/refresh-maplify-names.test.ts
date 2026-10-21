/**
 * The refresh says what a pull request would change in the checked-in baseline
 * (decision 083), so the reviewer reads the change, not two 100-line files.
 */

import { describe, expect, test } from 'vitest';

import type { Named } from './check-maplify-names.ts';
import { describeChange } from './refresh-maplify-names.ts';

const named = (name: string | null, sci: string, entity: string): Named => ({name, scientific_name: sci, entity_id: entity});

describe('describeChange', () => {
    test('nothing to say when the baseline already holds the report', () => {
        const pairs = [named('Orca', 'Orcinus orca', 'SSA:1')];
        expect(describeChange(pairs, pairs)).toEqual([]);
    });

    test('a new pair, a dropped pair, and a pair resolving elsewhere, each on its own line', () => {
        const before = [named('Orca', 'Orcinus orca', 'SSA:1'), named('Sei Whale', 'Balaenoptera borealis', 'SSA:2')];
        const after = [named('Orca', 'Orcinus orca', 'SSA:9'), named(null, 'Eschrichtius robustus', 'SSA:3')];
        expect(describeChange(before, after)).toEqual([
            '+ null / "Eschrichtius robustus" → SSA:3',
            '- "Sei Whale" / "Balaenoptera borealis" (was SSA:2)',
            '~ "Orca" / "Orcinus orca": SSA:1 → SSA:9',
        ]);
    });

    test('a pair with no common name is told apart from one named "null"', () => {
        expect(describeChange([named(null, 'Orcinus orca', 'SSA:1')], [named('null', 'Orcinus orca', 'SSA:1')]))
            .toEqual(['+ "null" / "Orcinus orca" → SSA:1', '- null / "Orcinus orca" (was SSA:1)']);
    });
});
