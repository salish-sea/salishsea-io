# 062 — An edit to a travel segment is a claim about two sightings, not a stored segment

**Status:** accepted · **Decided:** 2026-09-30 · **Extends:** [014](014-trust-and-curation-model.md) · **Relates:** [059](059-the-end-state-is-a-build-graph-with-a-small-authoritative-store.md), [029](029-map-symbology.md) · **Context:** GitHub [#445](https://github.com/salish-sea/salishsea-io/issues/445), bd `salish-71m7`

## Context

The map joins a day's sightings into travel segments with a rule in [`segments.ts`](../../src/segments.ts) that looks only at species, time and distance. "Why wasn't my sighting included?" comes up often enough to have its own issue (#445). In the case behind it, the sighting was 20.4 km from a track that had been waiting six hours, against a 20 km limit.

A better rule will help, and so will named identities, since registered groups and individuals now exist where they didn't when the rule was written. Neither can make segments right every time. Groups join up and split all day, and individuals wander off. What people on the water have worked out about who was with whom is often written down in a narrative, such as a Facebook thread, and not in any single sighting. So editors need to be able to split segments and link them together (PRODUCT.md, future directions).

There are two ways to store an edit. One stores the result: this segment, with these sightings in it. The other stores what the editor knows: these two sightings are the same animals, or they are not.

## Decision

An edit is a claim about a pair of sightings:

- **Must-link:** these two sightings are of the same animals. Joining two segments is a must-link between their facing ends.
- **Cannot-link:** these two sightings are not of the same animals. Splitting a segment is a cannot-link between the two sightings on either side of the cut.

The terms are borrowed from constrained clustering. A claim carries provenance the way an Identification does under [014](014-trust-and-curation-model.md): who asserted it, when, on what evidence (a link to the thread that settled it, a photo, being there), and their own certainty. Its status (candidate, validated, rejected) is the dataset's judgment, set by a curator.

Segments stay derived. Whatever rule builds them takes the claims as input and must honour them. A segment is never stored.

## Rejected

- **Store the edited segment.** Its membership goes stale as soon as anything changes. Sightings keep arriving for days (ingest re-reads a rolling ten-day window), and each new one would have to be fitted into a segment an editor froze, or be left out. A better rule could not improve an edited day without discarding the edit. A stored segment also asserts more than the editor knew. Someone who knows two sightings were the same group usually knows nothing about the other eight sightings that happened to be on the same line.
- **Edit the rule's parameters per day or per area.** This tunes the heuristic until it happens to give the right answer. Nothing records why, and the next rule change undoes it.

## Consequences

- The rule has to accept constraints. The current rule in `segments.ts` can't: it builds one segment at a time and never revisits a decision. The rules compared for #445, which consider every open segment at once, can take a cannot-link as "may not join" directly. A must-link needs more, because the two sightings may be far apart in time or space.
- Claims are written by our users, so they belong in the small authoritative store of [059](059-the-end-state-is-a-build-graph-with-a-small-authoritative-store.md), not the build.
- Segments around an edit can shift when the rule changes, which may surprise the editor who made the edit. The mitigation is for a sighting to explain its segment, naming the claim when one decided it ("linked by …, citing …"), rather than freezing the result.
- Must-links chain together. If one editor links A to B and another links B to C, while a third asserts that A and C are not the same animals, the claims contradict each other. That is a curation question for 014's status, not one for the rule to settle quietly.

## Open

- Whether a validated claim is a hard constraint or very strong evidence that a rule weighs against everything else.
- Whether a claim may link sightings on different days. Segments are drawn one day at a time today. Peter's lean (2026-09-30) is that days do need linking: if a group was near Olympia yesterday and nothing else was reported in Puget Sound, the group that turns up off Tacoma today is probably the same one. That inference rests on nothing else having been seen, so it is only as strong as the watching was.
- How a claim says what it rests on. A moderator who labels a sighting as a group because that group was seen nearby earlier is repeating the inference a rule makes, not adding evidence. A rule that counted that label as independent support would be citing its own conclusion; tracking theory calls this *data incest*. The map can feed the loop as well, once people label sightings to match a line it drew. Claims, and identifications under 014, need to record whether they rest on direct evidence (a photo, a recognised animal, being there) or on circumstance (continuity, proximity, the map), so a rule can discount the second kind.
- Who may assert a claim. The curator role in 014 is not built yet.
- How splitting and linking look in the map.
