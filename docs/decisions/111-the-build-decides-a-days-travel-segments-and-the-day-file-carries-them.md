# 111 — The build decides a day's travel segments, and the day file carries them

**Status:** accepted; first step built (no change to which reports join) · **Decided:** 2026-11-04, by Peter · **Work:** bd `salish-20u7.5` (epic `salish-20u7`, distance by sea) · **Amends:** [063](063-segments-join-by-space-and-time-and-never-across-ecotypes.md) (where its rule runs, not the rule) and [056](056-the-logged-out-read-path-is-built-as-static-files.md) (a day file's rows carry `segment`) · **Relates:** [098](098-an-animals-timeline-is-months-of-encounters.md)

## Context

The rule that joins a day's reports into travel segments ([063](063-segments-join-by-space-and-time-and-never-across-ecotypes.md), `occurrences2segments` in [`src/segments.ts`](../../src/segments.ts)) ran in two places. The browser joined every day's reports itself from the day file, for the map, the day's list and the subject timeline. The build ran the same code on the same rows for the encounter timelines ([`scripts/read-path/encounters.ts`](../../scripts/read-path/encounters.ts)). Two copies of one function were harmless while they were one function.

The epic `salish-20u7` changes the rule's distance from straight-line to distance by sea, measured over the basemap's water mask ([`src/sea-distance.ts`](../../src/sea-distance.ts)), so that a leg that would cross a peninsula costs what the animals would have to swim. If only the build measured by sea, the browser's tracks and the build's timelines would disagree about which reports belong together. So the join has to run in one place, or the mask has to reach both.

## Decision

**The build decides each day's segments and writes them into the day file.** [`occurrence-days.ts`](../../scripts/read-path/occurrence-days.ts) runs the join on a day's rows, in the order the file lists them, and writes on each occurrence `segment`: the id of the oldest occurrence of its segment, the same string on every occurrence of the segment. The field comes last in each document.

**The browser stops joining published reports.** `daySegments` in `src/segments.ts` groups a day's occurrences by `segment`, and every browser caller (the map, the day's list, the subject timeline) uses it. `occurrences2segments` stays for the build and for the fallback below.

**A signed-in tab attaches its own unpublished sightings to those segments by the existing straight-line rule.** A sighting just saved is in the write API's store but not yet in the day file ([065](065-the-store-and-write-api.md)); it has no `segment`, so the browser joins it to a published segment as that segment stood when the sighting was seen, or starts a segment for it. A sighting just saved therefore draws by straight line until the next build publishes it, at most five minutes later, and may then move to another segment or draw a different path. A contributor's sighting the build has already published keeps the `segment` its file copy has when the live copy is laid over it (`overlayOwn` in `src/write-api.ts`), so it stays with its track.

**A day file with no `segment` on any row is joined whole, as before.** That is a file written before this change; the site keeps working while the build rewrites them.

**This step changes no track.** The build keeps the straight-line rule, so the browser's grouping of a file the new build wrote reproduces `occurrences2segments` exactly; a test checks that for generated days. The encounter timelines still call `occurrences2segments` on the snapshot's rows, which are the day file's rows in the day file's order, so the build's two uses are one function on one input.

## Rejected

- **The browser loads the mask and runs the same search.** The Salish Sea cut of the mask is 77 KB, the whole range 177 KB, for every visitor, before a day can draw. It also keeps two computations of one answer, which can disagree whenever the mask, the search or the cost changes between a build and a cached page. It saves only the five minutes' wait of a just-saved sighting.
- **Both: the build writes segments, and the browser also measures by sea.** All the cost of the first, and a second answer for the same reports.

## Consequences

- `salish-20u7.3` (the join measures by sea) changes the build alone. The browser needs no new code or download for it.
- `salish-20u7.4` puts each leg's drawn path beside the segment in the day file.
- The browser no longer needs the join rule for published reports; it keeps it for a sighting the file does not have yet, and for a file from before this.
- Every day file is rewritten once when this ships: the day task's address includes the code it imports, so the first build after the change finds no basis for a partial run and replaces the directory whole ([056](056-the-logged-out-read-path-is-built-as-static-files.md), the runbook's description of the first build after a deploy). Each file gains about 20 bytes a report.
- A segment's id is its oldest report's id, so it changes when an older report joins the segment, and a tab that holds a segment's id (the day list's card key) re-keys on the next build.
