import { describe, expect, it } from 'vitest';
import { fold } from './fold.ts';

/**
 * The register's own published cases, from `dist/fold_test.tsv` in edition 2026.08.1.
 *
 * THE AUTHORITY IS THE RELEASE, not this list. `reconcile.ts` re-reads the cases out of
 * whichever edition it is reconciling against and aborts if the fold disagrees, which is
 * what stops a drifted fold producing a confidently wrong report. This copy exists so the
 * rule is also guarded in CI, where there is no network and no reconciliation running —
 * and so that a change to `fold()` fails a test rather than waiting for someone to run a
 * report against production.
 *
 * If these ever disagree with a published edition, the edition wins and this list is
 * stale; `reconcile.ts` will say so by name.
 */
const PUBLISHED: readonly [string, string][] = [
    ['T090', 't90'],
    ['T090s', 't90s'],
    ['T065A5', 't65a5'],
    ['T65A5', 't65a5'],
    ['T000', 't0'],
    ['J-35', 'j35'],
    ['J35', 'j35'],
    ['J17s', 'j17s'],
    ["Bigg's", 'biggs'],
    ['Bigg’s', 'biggs'],
    ['Biggs', 'biggs'],
    ['SRKW', 'srkw'],
    ['  Southern   Resident ', 'southern resident'],
];

describe('fold', () => {
    it.each(PUBLISHED)('reproduces the published case %s', (input, expected) => {
        expect(fold(input)).toBe(expected);
    });

    it('does not fold a trailing s, so a matriline never merges with its matriarch', () => {
        // The clause our own normalize_designation() has and ADR-0019 deliberately omits.
        // 126 such pairs exist; collapsing them would silently reassign animals.
        expect(fold('T090')).not.toBe(fold('T090s'));
        expect(fold('J17')).not.toBe(fold('J17s'));
    });

    it('compares digit runs as numbers, not as strings', () => {
        expect(fold('T002C1')).toBe(fold('T2C1'));
        expect(fold('T002C1')).not.toBe(fold('T002C10'));
    });

    it('keeps a long digit run exact rather than rounding it', () => {
        // Number would round these together at 2^53; BigInt does not. Not data the
        // register holds, but the failure it would cause is a silent wrong match.
        expect(fold('T9007199254740993')).not.toBe(fold('T9007199254740992'));
    });

    it('is idempotent, so a folded string is safe to fold again', () => {
        for (const [input] of PUBLISHED) expect(fold(fold(input))).toBe(fold(input));
    });
});
