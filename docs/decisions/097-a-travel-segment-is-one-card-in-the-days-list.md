# 097 — A travel segment of three reports or more is one card in the day's list

**Status:** accepted · **Decided:** 2026-10-28, by Peter · **Work:** bd `salish-fwyt.5` (epic `salish-fwyt`) · **Builds on:** [063](063-segments-join-by-space-and-time-and-never-across-ecotypes.md) (travel segments), [096](096-a-subjects-view-is-a-list-of-its-events.md) (a zoomed-out view summarizes)

## Context

The map joins a day's reports of one kind of animal into travel segments, drawn as one track ([063](063-segments-join-by-space-and-time-and-never-across-ecotypes.md)), but the day's list showed every report as its own card. On 20 October 2026, 21 reports narrated one Southern Resident encounter off Lime Kiln over 2 h 43 min, 21 cards in a row. Peter, 2026-10-28: "Even on a day-view, it would make sense to group occurrences from a travel segment into a single card with some summary information", and that card is the precedent for summarizing spans of time in an animal's timeline ([096](096-a-subjects-view-is-a-list-of-its-events.md), amended).

Two rounds of mockups from real days settled the card (https://desktop-wsl.tail5d2e45.ts.net/segment-card/, on Peter's tailnet).

## Decision

**A segment of three reports or more is one card**, the map's own segments, so a card and a track always agree. Two reports stay two cards (Peter).

**The card says:** the newest report's species and the largest count; the span of time; the animals the reports name, each with how many of the reports name it ("J pod, 1 of 21"); how far they moved ("17 km along their path over 2 h 43 min, about 6 km/h, ending 3.5 km from the first report; heading north at the last"); the latest report's words; the segment's photos; and its sources ("21 reports · via Orca Network ×19 · Orcasound · SalishSea.io").

**It opens to the reports' own cards,** newest first. A dot on the map that belongs to the segment opens it at that report's card.

## Rejected

- **A strip of the reports across the span:** the spacing of reports says when people looked, not what the animals did (Peter).
- **The directions in order** ("north → south → north → south → north"): accurate and uninformative for an encounter that milled; behaviour words do better, and wait (below).
- **The latest report's card with the rest stacked behind it:** hides the encounter's other reports, the calf among them.

## Consequences

Filed, not built, because each needs real thought (Peter: this round stays presentational):

- Behaviour tags from the reports' words, curated per kind of animal, pooled into the card (bd `salish-2ua9`), and behaviour inferred from movement (`salish-jdl2`).
- Reliability marks on a sighting and a segment (`salish-0420`); a chip's count of reports is the first step, "important to the shipping industry" (Peter).
- Reading what sighting text says with Claude Sonnet (`salish-26fp`).
