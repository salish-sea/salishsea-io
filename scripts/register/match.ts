/**
 * Deciding which register entity a catalogue string names, and refusing to decide where
 * the honest answer is "more than one" or "not any more".
 *
 * Separate from `reconcile.ts` so the rules can be tested against a constructed edition.
 * The cases that matter most — a retired identifier, a matriline sharing its matriarch's
 * designation — are ones the edition in production does not currently contain, and a rule
 * that is only exercised by data we happen to hold is a rule nobody has checked.
 */

import { fold } from './fold.ts';

export interface Edition {
    tag: string;
    digest: string;
    /** folded name -> entity ids that answer to it, retired ones included */
    byFold: Map<string, Set<string>>;
    entities: Map<string, { label: string; kind: string; rank: string }>;
    /**
     * Retired entity id -> its replacement, or null where substitution needs a human.
     *
     * Empty for an edition published before `searchable_name` gained the columns, which
     * is the correct reading: 2026.08.1 has no deprecations at all.
     */
    retired: Map<string, string | null>;
}

/**
 * Candidates for a catalogue string: all of them, the live ones, the live ones of the
 * kind the row claims to be, and — reported but never matched — the retired ones.
 *
 * THE KIND FILTER is not a tie-break dressed up as a rule. A `designations` row names an
 * animal; the matriline that folds to the same string is a different entity that happens
 * to share a designation, which is ADR-0019's stated reason for publishing the fold at
 * all. Every count is returned, so the filter's effect is visible rather than assumed.
 *
 * RETIRED IS NOT A CANDIDATE. A tombstone keeps its names upstream, so it still answers to
 * the string it always did. A row whose only candidate is retired has not found its entity
 * — it has found where its entity used to be — and adopting that identifier is precisely
 * what the register publishes `replaced_by` to prevent.
 */
export function candidates(edition: Edition, subject: string, kind: 'individual' | 'group') {
    const all = [...(edition.byFold.get(fold(subject)) ?? [])].sort();
    const live = all.filter((id) => !edition.retired.has(id));
    const ofKind = live.filter((id) => edition.entities.get(id)?.kind === kind);
    const retiredOfKind = all.filter(
        (id) => edition.retired.has(id) && edition.entities.get(id)?.kind === kind);
    return { all, live, ofKind, retiredOfKind };
}

/**
 * `one` is the only verdict a migration may act on. The rest are all reasons to stop, and
 * they are kept apart because they have different owners: `none` is a gap in the register,
 * `many` is a question for a curator, `wrong-kind-only` is a modelling difference between
 * the two schemas, and `retired-only` is a substitution to follow.
 */
export function verdictFor(ofKind: string[], live: string[], retiredOfKind: string[]): string {
    if (ofKind.length === 1) return 'one';
    if (ofKind.length > 1) return 'many';
    if (retiredOfKind.length) return 'retired-only';
    return live.length ? 'wrong-kind-only' : 'none';
}

/** Enough of each candidate for a human to tell them apart, which is C2's whole point. */
export function describeCandidates(edition: Edition, ids: string[]): string {
    return ids.map((id) => {
        const e = edition.entities.get(id);
        return e ? `${id} ${e.label} (${e.kind}${e.rank ? `/${e.rank}` : ''})` : id;
    }).join('; ');
}

/** How a `retired-only` row is reported: where it went, or that it needs a human. */
export function substitutionFor(edition: Edition, retiredOfKind: string[]): string {
    return retiredOfKind.map((id) => {
        const to = edition.retired.get(id);
        return to ? `${id} → ${to}` : `${id} → needs a human`;
    }).join('; ');
}
