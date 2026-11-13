/**
 * Scores a grouping of a day's reports into tracks against the hand labels in
 * scripts/read-path/fixtures/tracks/ (salish-2rki.1). A label names the travelling
 * party a report is about, and after a slash, where the party was in parts, which
 * part. Two reports with the same label belong on one track. Two reports of
 * different parties must not share one. Two parts of one party are not scored
 * against each other, and a report with no label is not scored at all.
 */
export type Labelled = {id: string, track: string | null};

export type DayScore = {
    /** Labels whose reports the grouping put on more than one track, with how many. */
    split: Record<string, number>,
    /** For each track that holds reports of more than one party, those parties. */
    mixed: string[][],
};

/** The party a label names: the part before the slash. */
export const partyOf = (track: string): string => track.split('/')[0]!;

export function scoreDay(rows: readonly Labelled[], segmentOf: ReadonlyMap<string, string>): DayScore {
    const segmentsOfLabel = new Map<string, Set<string>>();
    const partiesOfSegment = new Map<string, Set<string>>();
    for (const {id, track} of rows) {
        if (track === null) continue;
        const segment = segmentOf.get(id);
        if (segment === undefined) throw new Error(`the grouping has no track for ${id}`);
        if (!segmentsOfLabel.has(track)) segmentsOfLabel.set(track, new Set());
        segmentsOfLabel.get(track)!.add(segment);
        if (!partiesOfSegment.has(segment)) partiesOfSegment.set(segment, new Set());
        partiesOfSegment.get(segment)!.add(partyOf(track));
    }
    const split: Record<string, number> = {};
    for (const [track, segments] of [...segmentsOfLabel].sort(([a], [b]) => a < b ? -1 : 1))
        if (segments.size > 1) split[track] = segments.size;
    const mixed = [...partiesOfSegment.values()]
        .filter(parties => parties.size > 1)
        .map(parties => [...parties].sort())
        .sort((a, b) => a.join() < b.join() ? -1 : 1);
    return {split, mixed};
}
