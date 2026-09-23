/**
 * Which register entity a free-text taxon name names — the register as a dictionary for a
 * source that speaks in names, not identifiers (salish-53t.3, decision 049).
 *
 * Maplify sends a common name ("Southern Resident Killer Whale", "Gray") and a scientific
 * name ("Orcinus orca", "N/A", ""), and nothing else about what was seen. This answers the
 * register's C2 for those strings: compare `fold(query)` against the fold of every name the
 * register publishes (ADR-0019) — labels, common, hidden and historical names alike.
 *
 * PURE. The index is built from rows the caller has read (see `persist.ts`'s
 * `fetchNameIndex`), so the ingest core stays free of I/O and tests can construct an
 * edition that holds exactly the case they are about.
 *
 * Deliberately narrower than `match.ts`, which reconciles a catalogue of animals: a taxon
 * name never names an individual, so individuals are not candidates at all — an animal
 * nicknamed "Orca" must not capture every report of one. Groups stay candidates, because an
 * ecotype is exactly what "Southern Resident Killer Whale" names.
 */

import { fold } from '../../src/fold.ts';

/** One name as the register publishes it, with enough of its entity to filter on. */
export type RegisterName = {
    readonly entity_id: string;
    readonly name: string;
    readonly kind: string;
    /** Deprecated identifiers keep their names upstream; they are never an answer. */
    readonly retired: boolean;
    /** The label of the taxon the entity belongs to (register.taxon_entity_for), or null. */
    readonly taxon_label: string | null;
};

export type NameIndex = {
    readonly byFold: ReadonlyMap<string, ReadonlySet<string>>;
    readonly taxonLabel: ReadonlyMap<string, string | null>;
};

export type NameMatch =
    | { readonly verdict: 'one'; readonly entityId: string }
    | { readonly verdict: 'many'; readonly entityIds: readonly string[] }
    | { readonly verdict: 'none' };

export function buildNameIndex(names: readonly RegisterName[]): NameIndex {
    const byFold = new Map<string, Set<string>>();
    const taxonLabel = new Map<string, string | null>();
    for (const n of names) {
        if (n.retired || n.kind === 'individual') continue;
        const key = fold(n.name);
        if (!byFold.has(key)) byFold.set(key, new Set());
        byFold.get(key)!.add(n.entity_id);
        taxonLabel.set(n.entity_id, n.taxon_label);
    }
    return { byFold, taxonLabel };
}

function matchWhole(index: NameIndex, query: string): NameMatch {
    const ids = [...(index.byFold.get(fold(query)) ?? [])].sort();
    if (ids.length === 1) return { verdict: 'one', entityId: ids[0]! };
    return ids.length ? { verdict: 'many', entityIds: ids } : { verdict: 'none' };
}

/**
 * The entity a name names, if exactly one does.
 *
 * `many` is reported, never resolved by a tie-break. "Killer whale" names both *Orcinus
 * orca* and the monotypic genus *Orcinus*, where taking the species would lose nothing —
 * but "Common dolphin" names both *Delphinus delphis* and the six-species genus
 * *Delphinus*, whose register note says its name must not claim any one species. Nothing
 * in the names tells the two cases apart, so neither is guessed. (No record in the feed
 * today is ambiguous; Whale Alert's own labels, "Orca" and "Humpback", are unique.)
 *
 * A name of the form "X (Y)" that matches nothing whole is tried as its two parts, and
 * resolves if the parts that match agree on one entity: Whale Alert labels a killer whale
 * "Killer Whale (Orca)" and, in Spanish, "Orca (ballena asesina)". "Killer Whale" alone is
 * ambiguous; "Orca" is not; so the label resolves to the species.
 */
export function matchName(index: NameIndex, query: string | null): NameMatch {
    if (!query?.trim()) return { verdict: 'none' };
    const whole = matchWhole(index, query);
    if (whole.verdict !== 'none') return whole;
    const parts = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(query);
    if (!parts) return whole;
    const matches = [matchWhole(index, parts[1]!), matchWhole(index, parts[2]!)];
    const agreed = new Set(matches.flatMap((m) => (m.verdict === 'one' ? [m.entityId] : [])));
    if (agreed.size !== 1) return whole;
    const [entityId] = agreed as Set<string>;
    // An ambiguous part must still allow the answer: "Killer Whale" (species or genus)
    // allows the species "Orca" names; "Humpback Whale" does not, so "Humpback Whale (Orca)"
    // is a contradiction, not an orca.
    const allowed = matches.every((m) => m.verdict !== 'many' || m.entityIds.includes(entityId!));
    return allowed ? { verdict: 'one', entityId: entityId! } : whole;
}
