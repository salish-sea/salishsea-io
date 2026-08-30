import { describe, expect, it } from 'vitest';
import { fold } from './fold.ts';
import {
    candidates, describeCandidates, substitutionFor, verdictFor, type Edition,
} from './match.ts';

/**
 * A constructed edition, because the two cases that matter most are ones the edition in
 * production does not contain.
 *
 * `2026.08.1` has no deprecations at all, so nothing in a real run exercises the retired
 * path — and it will not be exercised by a real run until the edition that carries the
 * first one is published, which is exactly too late to find out the reconciliation adopted
 * a withdrawn identifier.
 *
 * The shape is the register's own: `SSA:0000001` was an ecotype merged into the community
 * `SSA:0000010`, and the tombstone keeps the name *Southern Resident* that both answer to.
 * `T065` names a matriline and its matriarch — 126 such pairs exist — which is why the
 * matching is kind-constrained rather than fold-alone.
 */
function edition(): Edition {
    const entities = new Map([
        ['SSA:0000001', { label: 'Southern Resident', kind: 'group', rank: 'ecotype' }],
        ['SSA:0000010', { label: 'Southern Resident', kind: 'group', rank: 'community' }],
        ['SSA:0002033', { label: 'T065s', kind: 'group', rank: 'matriline' }],
        ['SSA:0010192', { label: 'T065', kind: 'individual', rank: '' }],
        ['SSA:0009999', { label: 'Ghost', kind: 'individual', rank: '' }],
    ]);
    // What each entity answers to, as `searchable_name` publishes it: the tombstone keeps
    // its name, and the matriline carries its matriarch's bare designation as a hidden one.
    const names: [string, string][] = [
        ['SSA:0000001', 'Southern Resident'],
        ['SSA:0000010', 'Southern Resident'],
        ['SSA:0002033', 'T065s'],
        ['SSA:0002033', 'T065'],
        ['SSA:0010192', 'T065'],
        ['SSA:0009999', 'Ghost'],
    ];
    const byFold = new Map<string, Set<string>>();
    for (const [id, name] of names) {
        const key = fold(name);
        if (!byFold.has(key)) byFold.set(key, new Set());
        byFold.get(key)!.add(id);
    }
    return {
        tag: 'test',
        digest: 'x'.repeat(64),
        byFold,
        entities,
        retired: new Map([['SSA:0000001', 'SSA:0000010']]),
    };
}

describe('candidates', () => {
    it('does not offer a retired identifier, even though it still answers to the name', () => {
        const c = candidates(edition(), 'Southern Resident', 'group');
        expect(c.all).toEqual(['SSA:0000001', 'SSA:0000010']);
        expect(c.ofKind).toEqual(['SSA:0000010']);
        expect(c.retiredOfKind).toEqual(['SSA:0000001']);
    });

    it('separates a matriline from the matriarch that shares its designation', () => {
        const e = edition();
        expect(candidates(e, 'T065', 'group').ofKind).toEqual(['SSA:0002033']);
        expect(candidates(e, 'T065', 'individual').ofKind).toEqual(['SSA:0010192']);
        // Fold-alone would be an ambiguous pair; the kind is what resolves it.
        expect(candidates(e, 'T065', 'group').all).toHaveLength(2);
    });

    it('matches through the fold, so padding and case do not matter', () => {
        expect(candidates(edition(), 't65', 'individual').ofKind).toEqual(['SSA:0010192']);
    });
});

describe('verdictFor', () => {
    const verdict = (subject: string, kind: 'individual' | 'group') => {
        const c = candidates(edition(), subject, kind);
        return verdictFor(c.ofKind, c.live, c.retiredOfKind);
    };

    it('is `one` only when a single live entity of the right kind answers', () => {
        expect(verdict('T065s', 'group')).toBe('one');
        expect(verdict('Ghost', 'individual')).toBe('one');
    });

    it('is `one` where the other candidate is merely retired', () => {
        // The point of excluding the tombstone: this would otherwise be `many`, and a
        // migration would stop on a question that has already been answered upstream.
        expect(verdict('Southern Resident', 'group')).toBe('one');
    });

    it('is `retired-only` where every candidate of the right kind is withdrawn', () => {
        const e = edition();
        e.retired.set('SSA:0000010', null);
        const c = candidates(e, 'Southern Resident', 'group');
        expect(verdictFor(c.ofKind, c.live, c.retiredOfKind)).toBe('retired-only');
    });

    it('is `wrong-kind-only` where the only live candidate is the other kind', () => {
        expect(verdict('Ghost', 'group')).toBe('wrong-kind-only');
    });

    it('is `none` where nothing answers at all', () => {
        expect(verdict('T999', 'individual')).toBe('none');
    });

    it('is `many` where two live entities of the right kind answer', () => {
        const e = edition();
        e.retired.clear();
        const c = candidates(e, 'Southern Resident', 'group');
        expect(verdictFor(c.ofKind, c.live, c.retiredOfKind)).toBe('many');
    });
});

describe('reporting a retired candidate', () => {
    it('names the replacement, so the row says where to go instead', () => {
        expect(substitutionFor(edition(), ['SSA:0000001'])).toBe('SSA:0000001 → SSA:0000010');
    });

    it('says a human is needed where the register declined to name one', () => {
        const e = edition();
        e.retired.set('SSA:0000001', null);
        expect(substitutionFor(e, ['SSA:0000001'])).toBe('SSA:0000001 → needs a human');
    });

    it('describes candidates well enough to tell two of them apart', () => {
        expect(describeCandidates(edition(), ['SSA:0002033', 'SSA:0010192']))
            .toBe('SSA:0002033 T065s (group/matriline); SSA:0010192 T065 (individual)');
    });
});
