# 098 — An animal's timeline is months of encounters, and the list replaces the presence table

**Status:** accepted · **Decided:** 2026-10-28, by Peter · **Work:** bd `salish-fwyt.6` (epic `salish-fwyt`) · **Builds on:** [096](096-a-subjects-view-is-a-list-of-its-events.md) (a subject's view lists its events), [097](097-a-travel-segment-is-one-card-in-the-days-list.md) (a travel segment's card)

## Context

An animal's view in the sidebar ([096](096-a-subjects-view-is-a-list-of-its-events.md)) was to summarize its sightings over spans of time rather than list every report, after the card the day's list shows for a travel segment ([097](097-a-travel-segment-is-one-card-in-the-days-list.md)). Which spans, and what a span's summary says, were open.

T065A5 Elsie has 1,821 reports on 324 days. Run through the map's own travel segments ([063](063-segments-join-by-space-and-time-and-never-across-ecotypes.md)), they make 397 encounters: 63 of those days hold two or three. Sometimes that is one group seen twice (Saratoga Passage twice on 24 October 2026), sometimes two places 40 km apart (North Bay and Dalco Passage on 1 October). A mockup from T065A5's published reports settled the design (https://desktop-wsl.tail5d2e45.ts.net/subject-timeline/, on Peter's tailnet).

## Decision

**Two grains: the encounter and the month.** An **encounter** is one of a day's travel segments that holds at least one report of the subject. It can hold reports that don't name it, such as an unnamed "Biggs" report on the same track. Its card is the day's list's segment card, so an encounter reads the same in both places. There is no day grain: a day's card would merge two encounters that may disagree.

**The list, newest first:** the latest encounter's card, then a card per month with reports in the past 12 months, the newest open. A month opens to one line per encounter (its day, its span of time, where, how many reports and how many name the subject, how many others are named, its photos), and a line opens to the encounter's card. Months without reports show as a gap ("No reports in July to August").

**A month's card says:** how many days and encounters; where, as the places with how many days in each, and how far apart its two most distant encounters were; who else, as chips counting the encounters that name each other animal or group ("T137s 5 of 18", as 097's chips count reports); its photos; how many reports name the subject itself and how many reach it through its matriline (T065As); its sources; and, where it applies, "First report of 2026" or "First report in 28 days". Peter: all of it is good, and "Scott will love this."

**The switch filters the list as it does the map:** Past 12 months shows this month and the eleven before it, whole, on the Pacific clock, so no month is split between the list's two parts (the map drew the 12 months back from the moment before); All time adds a card per earlier year, saying the same things, which opens to its months. This settles 096's question of whether the switch filters the list (Peter: "the map should mirror the list").

**The list replaces the presence table** (the grid of reports by year and month) in the sidebar.

## Rejected

- **A day grain:** a day's encounters can be far apart, and one card would hide that.
- **Encounters under month headings, without a month's card:** shorter per encounter, but nothing says what a month was like.
- **A table of years by months** as the timeline (already rejected in 096's amendment): it counts reports and says nothing else.

## Undecided

- **All time:** it may want to be a view of its own rather than more of the same list (Peter, unsure); it stays as the mockup has it for now.
- **Place names:** the mockup names the nearest larger water body, which says "Puget Sound" too often. A better name for where an encounter was is `salish-fwyt.2`'s.
- **A group's timeline:** a matriline's encounters are the ones holding a report of the group; whether its members' reports join them is 096's open question.
- **The full page** keeps its presence table until the timeline is built for it too.

## Consequences

- An encounter needs every report of its day, not only the subject's, so the read-path build writes each subject's encounters, already summarized (`encounters/<kind>/<id>.json`, [scripts/read-path/encounters.ts](../../scripts/read-path/encounters.ts)). The browser fetching the day files instead would cost Elsie's 324 files, 14 MB.
- The glossary gains **Encounter**.
