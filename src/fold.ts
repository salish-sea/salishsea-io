/**
 * The animals register's name-comparison rule (its ADR-0019), implemented once.
 *
 * The register publishes a fold rather than a normalized column: to decide whether a
 * typed string names an entity, compare `fold(query)` against `fold(name)` for every
 * published name. Nothing stored or displayed is ever rewritten — `T090` keeps its zero,
 * `Bigg's` keeps its apostrophe.
 *
 * There is one of it in TypeScript, used by the browser and the scripts alike, with a SQL
 * twin (`register.fold`, migration 20260923040000) and a hand copy in the edge handler,
 * which cannot import from src/. It replaced our own `normalize_designation()`
 * (salish-8vr.18), because a second, subtly different rule is how two systems come to
 * disagree about which animal a report named.
 */

/**
 * The comparison form of a name. Four steps, in order, and no others.
 *
 * Note what is NOT here: a trailing `s` is never folded away. `T090` is an animal and
 * `T090s` is the matriline it anchors, and merging them would collapse 126 pairs of
 * distinct entities — the exact pair a catalogue reconciliation has to keep apart.
 *
 * Digit runs compare as numbers, so `T090` and `T90` are the same name. BigInt, not
 * Number: a long enough run of digits is still a valid string, and silently losing
 * precision would fold two different designations together.
 */
export function fold(name: string): string {
    const stripped = name.toLowerCase().replace(/['’-]/g, '');
    const collapsed = stripped.split(/\s+/).filter(Boolean).join(' ');
    return collapsed.replace(/\d+/g, (digits) => String(BigInt(digits)));
}
