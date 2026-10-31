# 103 — What a port needs is where whales may be in the next half hour, not the reports; the file of recent sightings waits

**Status:** accepted · **Decided:** 2026-10-31, by Peter · **Work:** GitHub [#738](https://github.com/salish-sea/salishsea-io/issues/738) (kept open, set aside) · **Amends:** [086](086-what-we-know-now-is-a-file-to-poll.md) (what we know now is a file to poll)

## Context

[086](086-what-we-know-now-is-a-file-to-poll.md) answered the Marine Exchange of Puget Sound's request for a whale layer in PortLink, its shared picture of vessel traffic, with a file of the last seven days' sightings: a versioned schema, Acartia's fields mapped, the manifest as the signal that it changed. #738 carried the work. Going through what was left to choose (which sources, a licence on each row, the address, how confirmation reads, which species), Peter stepped back from the premise.

## Decision

**What the shipping industry needs is our best judgement of where whales might meet vessels in the next half hour or so, not the reports behind it.** Peter: they "need us to represent our best judgment of where whales might interact with vessels over the next 30 minutes, say. They're maybe only passingly interested in the reports that go into this." A ship's bridge or a port's traffic picture acts on where the animals may be, and a list of reports leaves that inference to every consumer, each of whom would make it worse than we can.

**The file of recent sightings is not built now.** #738 stays open as the record of what it would be, should a consumer want reports after all. The rest of [086](086-what-we-know-now-is-a-file-to-poll.md) stands: nothing is pushed until a subscriber asks for push, and our own sightings are CC-BY, published beyond the site once their contributor has agreed.

**The basic version is within reach, because the map already draws it.** Around a track's last sighting, the map draws two rings: where its animals might be now, and in half an hour, at their species' typical speed (`imputedPositions` in [src/segments.ts](../../src/segments.ts)), for six hours after that sighting. A forecast for a port starts as that ring, drawn with better information. The directions named, none of them committed to:

- **Water only.** Clip the ring to water, and measure the distance along water rather than across land: a group last seen in Haro Strait can't be on San Juan Island.
- **Heading.** Stretch the ring along the track's direction of travel, since a group travelling north is likelier to be north of its last position than south of it.
- **Better speeds.** A typical and a maximum speed, separately, per ecotype or group, each with a source (bd `salish-xz0i`). Today it is one figure per species, and the orca figure has no recorded source.
- **Behaviour.** A smaller ring when the reports say foraging or milling, a larger one when they say travelling, from the behaviour words a report's text carries (bd `salish-2ua9`).

**The ambitious version is a predictor of movement learned from past behaviour,** which Peter has heard graduate students are working on but has not seen delivered, much less run in production. It isn't planned here.

## Rejected

- **Building #738's file now, as 086 decided.** It answers a question the consumer is only passingly interested in, and binds us to a public schema of reports before anyone has asked for reports.
- **Settling the file's open choices anyway, for when it's wanted.** Choices made for a consumer who doesn't need the thing would be made against the wrong need.

## Undecided

- **How a forecast reaches a port system:** a file of rings or areas, a layer, or something else; and whether a forecast is a public product at all or made with one partner first.
- **How a forecast states its confidence,** and its age: a ring drawn from a sighting five hours old means something different from one drawn from a sighting five minutes old. The map shows this by fading the ring; a machine reader needs it said.
- **When to start.** Nothing is scheduled.

## Consequences

- [086](086-what-we-know-now-is-a-file-to-poll.md) is amended, not superseded: its build decision waits, and the rest of it stands.
- #738 gets a comment saying it is set aside and why, and stays open.
- The ring's improvements are filed as one bd issue (`salish-2adm`), behind `salish-xz0i` and beside `salish-2ua9`, so they are found when a forecast is wanted.
