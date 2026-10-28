# 096 — An animal's or group's view lists its events, and the map shows its sightings over the past year or all time

**Status:** accepted · **Decided:** 2026-10-28, by Peter · **Work:** bd `salish-fwyt.4` (epic `salish-fwyt`) · **Builds on:** [093](093-the-sidebar-shows-one-subject-at-a-time.md) (the sidebar shows one subject at a time)

## Context

Since [093](093-the-sidebar-shows-one-subject-at-a-time.md), opening an animal or a matriline replaces the day's list in the sidebar with its page's content, but the map beside it still shows the day the visitor came from. A subject's own sightings are already published beside its page (`profiles/<kind>/<id>.links.json`, every report's id, time and place; the page's small map draws them, [076](076-the-map-moves-to-maplibre.md)). T065A5 Elsie has 1,827 of them, going back years.

Watersheds will have dated events and news written by us (bd `salish-7ds1.3`); an animal has a life the register records (births, its offspring, whether it is alive) and sightings.

## Decision

**While a subject is open, the map shows its sightings, not the day's.** A two-way switch takes the calendar's place: **Past 12 months** or **All time** (Peter: "a segmented control in place of the calendar"). Past 12 months is the default, because recent reports are what a visitor most often wants and all of them at once bury those.

**The sidebar lists the subject's events, newest first.** An event is one dated thing in a subject's story: a sighting, a life event from the register (a birth, a calf's birth, a death), or a news item we wrote. Sightings are the first kind; the others join the same list, so a reader sees a life in order, and the list a watershed shows (`salish-7ds1.3`) is the same list with other kinds of event (Peter: "occurrences will get generalized to events in the sidebar, so we can include news items").

**Notable sightings are marked:** the first report of a calf, the first report of the year, and a report with photos (Peter, all three). A sighting far from the subject's usual range is notable too, but waits: knowing a usual range is work of its own.

## Rejected

- **A banner over the map, or the date controls dimmed,** to say the map isn't showing the day: the switch in the calendar's place says what the map shows, and the sidebar's Back link says where the day is.
- **Every report at equal weight with no limit:** years of reports would bury the recent ones.

## Undecided

- The name: "event" is a working name, since Darwin Core's Event means a sampling event; to be settled when the list is built (Peter).
- Whether the switch also filters the sidebar's list, or only the map.
- How news items are written and stored: the same format as a watershed's (`salish-7ds1.3`), not yet designed.
- Which register facts make life events: a calf's birth year is known, an animal's own death year is not in the page data yet.
- Whether a group's view gathers its members' reports too, perhaps by a second control: the group's own, or the group with its members (Peter, unsure).

## Consequences

- The glossary gains **Event** in this sense, as a working name.
- A group's sightings are the ones its page's small map draws: reports of the group, which aren't all of its members' (T065As has 1,261 in its file, its member T065A5 1,827 in hers).
