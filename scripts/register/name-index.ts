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

/**
 * The rows `buildNameIndex` reads, as SQL: each name the register publishes for a non-individual
 * entity, with whether the entity is retired and the label of the taxon it belongs to. One
 * text for both readers: the ingest runs it in Postgres (persist.ts `fetchNameIndex`), and
 * the read-path build runs it in DuckDB over the snapshot's copy of the register
 * (scripts/read-path/derive/maplify-entities.ts), so the two cannot read the register
 * differently.
 *
 * Per entity first, then fanned out to its names, so the taxon lookup runs once per entity
 * rather than once per name. Individuals are dropped here as well as in buildNameIndex (which
 * owns the rule): they are most of the register, and a tick should not read 600 animals to
 * discard them. The taxon comes from register.ancestor directly rather than
 * register.taxon_entity_for, whose only extra is following a merge — and retired entities are
 * never candidates. Measured on production: the per-name form cost 182 ms and 30,581 buffers
 * every five minutes.
 */
export const NAME_INDEX_SQL = `
    WITH ent AS (
        SELECT e.entity_id, e.kind,
               d.entity_id IS NOT NULL AS retired,
               CASE WHEN e.kind = 'taxon' THEN e.label
                    ELSE (SELECT t.label FROM register.ancestor a
                           JOIN register.entities t ON t.entity_id = a.ancestor_id
                           WHERE a.entity_id = e.entity_id AND a.ancestor_kind = 'taxon'
                           ORDER BY a.depth LIMIT 1)
               END AS taxon_label
        FROM register.entities e
        LEFT JOIN register.deprecations d ON d.entity_id = e.entity_id
        WHERE e.kind <> 'individual'
    ),
    named AS (
        SELECT entity_id, label AS name FROM register.entities
        UNION ALL
        SELECT entity_id, name FROM register.names
    )
    SELECT n.entity_id, n.name, ent.kind, ent.retired, ent.taxon_label
    FROM named n
    JOIN ent ON ent.entity_id = n.entity_id`;

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
