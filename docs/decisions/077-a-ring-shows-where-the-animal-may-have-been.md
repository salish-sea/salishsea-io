# 077 — A ring shows where the animal may have been, when the source says so about the animal

**Status:** accepted · **Decided:** 2026-10-12 · **Context:** bd `salish-hb8k`; Orcasound asked for ranges in [orcasound/orcasite#1080](https://github.com/orcasound/orcasite/issues/1080) · **Amends:** [029](029-map-symbology.md) (which rejected drawing location uncertainty) · **Relates:** [013](013-orcasound-acoustic-occurrences.md) (bouts as occurrences), [076](076-the-map-moves-to-maplibre.md) (the map this is drawn on)

## Context

An Orcasound bout is drawn as a dot on the hydrophone that heard it. That dot says the animals were at the hydrophone, when they were somewhere within hearing range of it, perhaps several kilometres away. Someone reporting a sighting from shore has the same problem in a smaller way: they place the animal on the map, and may know it could be a kilometre either side.

029 rejected drawing location uncertainty, for two reasons that still hold for most of what we hold:

- **The values describe the wrong thing.** iNaturalist's positional accuracy is usually how well the observer's phone knew where *the observer* was. A 31 m circle around an orca seen from Lime Kiln would be a precise, confident, wrong claim about the orca.
- **They don't fit one picture.** iNaturalist's values run from a few metres to thousands of kilometres, HappyWhale's are three fixed buckets that record coordinate precision, and 64% of records state nothing.

Both objections are about values that describe the reporter. A bout's hearing range and a reporter's own estimate of how far off the animal was both describe the animal, which is what a ring on the map would claim.

## Decision

**The map draws a ring for a position whose stated uncertainty describes the animal, and for nothing else.** Two sources qualify:

- **Our own sightings**, whose author can say how far the animal may have been from the point they placed. The form takes it as a distance in metres, and on the map as a ring around the subject with a handle to drag its radius. Empty means not stated. The write API stores it (it used to accept the value and drop it, as Postgres had), and the export carries it as `coordinateUncertaintyInMeters`, which in Darwin Core describes the location of the occurrence, the same sense.
- **Orcasound bouts**, whose ring is the hydrophone's hearing range.

iNaturalist's and HappyWhale's values stay in the data and in the export as they are, and are not drawn. 029's reasoning stands for them.

**One field, decided by source.** Every occurrence already carries `accuracy` in metres. Whether the map draws it depends on the provider: ours (`direct`) and Orcasound's (`orcasound`). The rule lives in one place in the map's code.

**A bout's range is Orcasound's to state, and until it does, ours to estimate.** How far a sound carries depends on the species and on how loud the call was when it arrived, so it belongs on the bout, where Orcasound's moderators know the conditions (#1080). Until bouts carry it, each hydrophone has a range in `data/reference/hydrophones.tsv`, one row per Orcasound feed, every one 5 km to start. That number is our rough estimate, and is described as such.

**How it looks.** A faint fill in the taxon's colour with a thin dashed edge, the radius true on the water, drawn under every track, dot and label so it never hides another sighting. The dot stays at the stated position. A ring smaller than its dot on screen adds nothing visible.

**Where it isn't drawn, for now.** The profile pages' pictures and the ecotype page's small maps (076, 067) draw their dots as before.

## Rejected

- **Drawing every source's stated accuracy.** Most rings would be invisible and a few would cover the map, and the large ones would claim the animal could be anywhere in them when the value is about the observer.
- **Also drawing iNaturalist's values above some size**, such as 1 km. A large iNaturalist value is more often a location blurred on purpose than a statement about the animal.
- **Replacing the dot with the ring.** It would say more honestly that there is no precise point, but the dot is what the label, the track and the click all hang on.
- **A blurred halo.** It reads as "somewhere around here", but the radius, which is the claim, can't be read off it.
- **One fixed range for every bout, in the code.** A per-hydrophone file costs little more and is where Orcasound's numbers will land feed by feed.
- **No ring for bouts until Orcasound states a range.** Bouts are the case that prompted this, and a labelled estimate is better than a dot that says the animals were at the hydrophone.

## Consequences

- When orcasite publishes a range per bout (#1080), the derivation uses it and the file becomes the fallback for bouts without one. Ranges by species or signal strength may mean one bout's occurrences get different rings.
- `observed_from`, the observer's own position on our sightings, remains the other honest answer to "where was the animal", and the form now asks both.
