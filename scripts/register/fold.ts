/**
 * The animals register's name-comparison rule (its ADR-0019), implemented once.
 *
 * The register publishes a fold rather than a normalized column: to decide whether a
 * typed string names an entity, compare `fold(query)` against `fold(name)` for every
 * published name. Nothing stored or displayed is ever rewritten — `T090` keeps its zero,
 * `Bigg's` keeps its apostrophe.
 *
 * It lives in its own module so it can be tested without running a reconciliation, and so
 * there is exactly one of it. ADR-0012 lists our `normalize_designation()` as a divergence
 * to resolve (salish-8vr.18) precisely because a second, subtly different fold is how two
 * systems come to disagree about which animal a moderator meant.
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
